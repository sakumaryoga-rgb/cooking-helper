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

// 1,000件を4つに分ける(ケースの中で一番手間のかかる材料で決める):
// 1 full: 食材と分量まで自動で確定 / 2 textAmount: 食材は自動で確定、分量は元の表記のまま保存(数で比べない)
// 3 deferred: 確認待ちの材料を含むが、そのまま保存できる(あとで選ぶ) / 4 blocking: 保存の前に確認が必須
// wrong: 安全性の誤り(別の食材への自動の紐付け・誤統合・数量の欠落・見出しの取り込み・分割漏れ)
function score(cases, run, { catalog, index }) {
  const catalogKeys = new Set(catalog.map((c) => nameKey(c.name)))
  const buckets = { full: [], textAmount: [], deferred: [], blocking: [], wrong: [] }
  const resolveMaster = (m) => {
    const r = matchIngredientName(m, index)
    return r.status === 'auto' ? r.option.name : m
  }
  const inCatalog = (m) => catalogKeys.has(nameKey(m)) || matchIngredientName(m, index).status === 'auto'
  for (const c of cases) {
    const exp = c['期待判定']
    const out = run(c['元の材料表記'])
    const items = out.filter((o) => o.item).map((o) => o.item)
    const stocked = items.filter((i) => i.include)
    const masters = c['想定マスタ候補'] ? c['想定マスタ候補'].split('／') : []
    const expQty = num(String(c['数量']).split('-')[0])
    const record = (bucket, why) => buckets[bucket].push({ c, why, items })
    const resolved = (i) => !i.needsChoice
    const autoName = (i) => (resolved(i) && i.kind !== 'new' ? i.name : null)
    const same = (i, m) => autoName(i) && (nameKey(autoName(i)) === nameKey(m) || nameKey(autoName(i)) === nameKey(resolveMaster(m)))
    const bucketOf = (list) =>
      list.some((i) => i.include && !resolved(i)) ? 'deferred' : list.some((i) => i.include && !(Number(i.requiredQuantity) > 0)) ? 'textAmount' : 'full'

    if (exp === 'HEADING' || exp === 'NO_STOCK') {
      if (stocked.length === 0) record('full', '在庫に数えない')
      else record('wrong', exp === 'HEADING' ? '見出しを食材にした' : '在庫に数える')
      continue
    }
    if (stocked.length === 0 && items.length === 0) {
      record('wrong', '食材として読めない')
      continue
    }
    if (exp === 'SPLIT') {
      if (items.length !== masters.length) {
        record('wrong', `分割していない(${items.length}/${masters.length})`)
        continue
      }
      const wrongItem = items.some((i, k) => autoName(i) && inCatalog(masters[k]) && !same(i, masters[k]))
      if (wrongItem) record('wrong', '分割後に別の食材')
      else record(bucketOf(items), '分割')
      continue
    }
    const first = items[0]
    // 数量: 元の数量を数か、元の分量の表記で失っていない
    const p = first.parsed ?? {}
    const qtyKept = expQty == null || p.quantity === expQty || p.grams === expQty || p.ml === expQty || Boolean(p.range) || (first.amountText ?? '').length > 0
    if (!qtyKept) {
      record('wrong', `数量を失った(${p.quantity}${p.unit} 期待${c['数量']}${c['単位']})`)
      continue
    }
    if (exp === 'KEEP_DISTINCT') {
      const forbidden = (c['補助数量_状態'].match(/混同禁止: (.+)$/) ?? [])[1]
      if (forbidden && autoName(first) && (nameKey(autoName(first)) === nameKey(forbidden) || nameKey(autoName(first)) === nameKey(resolveMaster(forbidden))) && !same(first, masters[0])) {
        record('wrong', `混同: ${forbidden}`)
        continue
      }
    } else if (exp === 'AUTO' || exp === 'AUTO_CANDIDATE') {
      if (autoName(first) && inCatalog(masters[0]) && !same(first, masters[0])) {
        record('wrong', `別の食材に自動: ${autoName(first)}`)
        continue
      }
    } else {
      // REVIEW*: 自動で決めた食材が、期待の食材でも、属性を外した同じ食材でもなければ誤り
      const m = matchIngredientName(first.sourceName ?? '', index, { notes: p.notes ?? [] })
      const baseKey = m.analysis?.base
      if (autoName(first) && masters[0] && !same(first, masters[0]) && nameKey(autoName(first)) !== baseKey && nameKey(resolveMaster(m.analysis?.display ?? '')) !== nameKey(autoName(first))) {
        record('wrong', `別の食材に自動: ${autoName(first)}`)
        continue
      }
    }
    record(bucketOf([first]), exp)
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
  globalThis.__ingredientCaseBuckets = b
  it('誤判定(別の食材への自動の紐付け・誤統合・数量の欠落・見出しの取り込み・分割漏れ)がない', () => {
    expect(b.wrong.map((r) => `${r.c.id} ${r.c['元の材料表記']}: ${r.why}`)).toEqual([])
  })
  it('8割以上を保存前の確認なしで登録できる(確認が必須なものはない)', () => {
    expect(cases).toHaveLength(1000)
    const total = b.full.length + b.textAmount.length + b.deferred.length + b.blocking.length
    expect(total).toBe(1000)
    expect(b.blocking).toHaveLength(0)
    expect(b.full.length + b.textAmount.length).toBeGreaterThanOrEqual(800)
  })
})
