import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildNameIndex, matchIngredientName, nameKey } from '@/lib/ingredientName'
import { importIngredientLines } from './match'

// 食材名寄せの検証ケース1,000件(__fixtures__/ingredient_cases.json)を、取り込みと同じ流れに通して採点する。
// 期待結果は参考値なので、食材の意味を優先して採点する:
// - AUTO / AUTO_CANDIDATE: 期待の食材に自動で決まれば成功。決めずに確認・新規登録に回るのは安全(確認)。別の食材に自動で決まったら誤り
// - KEEP_DISTINCT: 混同してはいけない食材に決まったら誤り
// - REVIEW / REVIEW_STATE / REVIEW_OR_CREATE: 自動で決めたら誤り
// - SPLIT: 食材ごとに分け、各分量を保つ。HEADING / NO_STOCK: 在庫に数えない
// 数量: 期待の数量を失ったら誤り(幅は確認に回れば可)

function loadSeed(root) {
  const seed = readFileSync(`${root}/supabase/migrations/002_ingredient_catalog.sql`, 'utf8')
  const catalog = [...seed.matchAll(/\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+)\)/g)].map((m, i) => ({ id: `c${i}`, name: m[1], unit: m[2], category: m[3], group_id: null }))
  const s13 = readFileSync(`${root}/supabase/migrations/013_catalog_ownership_aliases_staples.sql`, 'utf8')
  const block = s13.slice(s13.indexOf('from (values'), s13.indexOf(') as a(catalog_name, alias)'))
  const aliases = [...block.matchAll(/\('([^']+)', '([^']+)'\)/g)]
    .map((m) => ({ alias: m[2], catalog_id: catalog.find((c) => c.name === m[1])?.id, group_id: null }))
    .filter((a) => a.catalog_id)
  return { catalog, aliases }
}

const num = (s) => {
  if (s == null || s === '') return null
  const t = String(s)
  if (t.includes('/')) { const [a, b] = t.split('/').map(Number); return a / b }
  return Number(t)
}

// result: { lines: [{ heading?, notStocked?, item }] } を作るのは呼び出し側(pipeline)
function score(cases, run, { catalog, index }) {
  const catalogKeys = new Set(catalog.map((c) => nameKey(c.name)))
  const buckets = { auto: [], review: [], wrong: [] }
  for (const c of cases) {
    const exp = c['期待判定']
    const out = run(c['元の材料表記'])
    const items = out.filter((o) => o.item).map((o) => o.item)
    const stocked = items.filter((i) => i.include)
    const first = items[0]
    const masters = c['想定マスタ候補'] ? c['想定マスタ候補'].split('／') : []
    const expQty = num(c['数量'].split('-')[0])
    const isRange = String(c['数量']).includes('-')
    const record = (bucket, why) => buckets[bucket].push({ c, out: items.map((i) => `${i.name}[${i.needsChoice ? 'choose' : i.kind}]${i.requiredQuantity}${i.unit}${i.include ? '' : '(除外)'}`).join(' + ') || out.map((o) => (o.heading ? '見出し' : '?')).join(','), why })
    const autoName = (i) => !i.needsChoice && i.kind !== 'new' ? i.name : null
    // 期待の食材名が、こちらの食材マスタでは別の書き方の場合(しょうゆ / 醤油)は、照合した結果で比べる
    const resolveMaster = (m) => { const r = matchIngredientName(m, index); return r.status === 'auto' ? r.option.name : m }
    const sameMaster = (i, m) => autoName(i) && (nameKey(autoName(i)) === nameKey(m) || nameKey(autoName(i)) === nameKey(resolveMaster(m)))
    const inCatalog = (m) => catalogKeys.has(nameKey(m)) || matchIngredientName(m, index).status === 'auto'

    if (exp === 'HEADING') {
      if (stocked.length === 0) record('auto', '見出し・在庫対象外')
      else record('wrong', '見出しを食材にした')
      continue
    }
    if (exp === 'NO_STOCK') {
      if (stocked.length === 0) record('auto', '在庫に数えない')
      else record('wrong', '在庫に数える')
      continue
    }
    if (exp === 'SPLIT') {
      if (items.length !== masters.length) { record('wrong', `分割していない(${items.length}/${masters.length})`); continue }
      const vague = !c['数量']
      const qtyOk = items.every((i) => vague ? !i.include || i.requiredQuantity === '' : i.parsed?.quantity === expQty || Number(i.requiredQuantity) === expQty || (i.parsed?.ml != null))
      if (!qtyOk) { record('wrong', '分割後の分量が違う'); continue }
      const allAuto = items.every((i, k) => sameMaster(i, masters[k]))
      const anyWrong = items.some((i, k) => autoName(i) && !sameMaster(i, masters[k]) && inCatalog(masters[k]))
      if (anyWrong) record('wrong', '分割後に別の食材')
      else record(allAuto ? 'auto' : 'review', allAuto ? '分割して自動' : '分割して確認')
      continue
    }
    if (!first) { record('wrong', '食材として読めない'); continue }
    // 数量: 期待の数量を失っていない(範囲は要確認なら可)
    const p = first.parsed ?? {}
    const qtyKept = expQty == null || p.quantity === expQty || p.grams === expQty || p.ml === expQty || (isRange && first.needsCheck)
    if (!qtyKept) { record('wrong', `数量を失った(${p.quantity}${p.unit} 期待${c['数量']}${c['単位']})`); continue }
    if (exp === 'KEEP_DISTINCT') {
      const forbidden = (c['補助数量_状態'].match(/混同禁止: (.+)$/) ?? [])[1]
      const names = [first.name, ...(first.needsChoice ? [] : [])]
      if (forbidden && autoName(first) && nameKey(autoName(first)) === nameKey(forbidden)) record('wrong', `混同: ${forbidden}`)
      else if (sameMaster(first, masters[0])) record('auto', '区別して自動')
      else if (autoName(first)) record(inCatalog(masters[0]) ? 'wrong' : 'auto', '別の食材に自動')
      else record('review', '確認')
      void names
      continue
    }
    if (exp === 'AUTO' || exp === 'AUTO_CANDIDATE') {
      if (sameMaster(first, masters[0])) record(first.needsCheck && !isRange && expQty != null ? 'review' : 'auto', first.needsCheck ? '自動(分量の確認)' : '自動')
      else if (autoName(first)) record('wrong', `別の食材に自動: ${autoName(first)}`)
      else record('review', inCatalog(masters[0]) ? '確認(マスタにある)' : '確認(マスタにない)')
      continue
    }
    // REVIEW / REVIEW_STATE / REVIEW_OR_CREATE: 自動で決めない
    if (autoName(first) && !(exp === 'REVIEW_OR_CREATE' && nameKey(first.name) === nameKey(c['元の材料表記'].split(/\s/)[0]))) record('wrong', `自動で決めた: ${autoName(first)}`)
    else record('review', '確認・新規')
  }
  return buckets
}

const root = process.cwd()
const { catalog, aliases } = loadSeed(root)
const index = buildNameIndex({ catalog, aliases })
const fixture = JSON.parse(readFileSync(path.resolve(root, 'src/lib/recipeImport/__fixtures__/ingredient_cases.json'), 'utf8'))
const cases = fixture.cases.map(([id, exp, text, master, qty, unit, note]) => ({
  id, 期待判定: exp, 元の材料表記: text, 想定マスタ候補: master, 数量: qty, 単位: unit, 補助数量_状態: note,
}))

describe('食材名寄せの検証ケース1,000件', () => {
  const b = score(cases, (line) => importIngredientLines([line], { catalog, aliases, index }), { catalog, index })
  it('誤判定(別の食材への自動の紐付け・誤統合・数量の欠落・見出しの取り込み・分割漏れ)がない', () => {
    expect(b.wrong.map((r) => `${r.c.id} ${r.c['元の材料表記']}: ${r.why}`)).toEqual([])
  })
  it('自動で正しく判定できる件数が下がっていない', () => {
    expect(cases).toHaveLength(1000)
    expect(b.auto.length).toBeGreaterThanOrEqual(439)
    expect(b.auto.length + b.review.length).toBe(1000)
  })
})
