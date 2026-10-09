import { buildNameIndex, displayName, matchIngredientName, nameKey as normalizeName } from '@/lib/ingredientName'
import { isHeadingLine, parseIngredientLine, splitIngredientLine } from './ingredientLine'
// 取り込んだ材料を、冷蔵庫の食材(同じグループ)→ 食材マスタ の順に名前で突き合わせ、
// 保存先の食材と、その食材の単位での必要量を決める。決めきれないものは needsCheck にして画面で確かめてもらう。

const KNOWN_UNITS = ['g', 'ml', '個', '本', '枚', 'パック', '束', '玉', '尾', '切れ', '袋', '缶', '丁', '片', 'かけ', '株', '房', '節', '腹']

// 在庫で管理しないもの(最初は保存しない。画面でチェックすれば保存できる)
// (揚げ油・打ち粉のように量を決めにくく、在庫から引かないものも含む。レシピの材料としては残す)
const NOT_STOCKED = ['水', 'お湯', '湯', '熱湯', '氷', '氷水', 'ゆで汁', '茹で汁', 'のゆで汁', 'の茹で汁', '戻し汁', 'の水', '揚げ油', '打ち粉']

export function isNotStocked(name) {
  const n = String(name ?? '').normalize('NFKC').replace(/[(（[【][^)）\]】]*[)）\]】]/g, '').trim()
  return NOT_STOCKED.some((w) => n === w || (w.length >= 2 && n.endsWith(w)))
}

// 食材名の正規化と名寄せは lib/ingredientName に共通化(取り込み・材料の追加と編集・冷蔵庫への追加・検索で同じ処理)
export { displayName, nameKey as normalizeName } from '@/lib/ingredientName'

// 解析した分量を、保存先の食材の単位に直す。直せなければ null
export function quantityInUnit(parsed, unit) {
  if (!parsed || parsed.vague) return null
  if (unit === 'g' && parsed.grams != null) return parsed.grams
  if (unit === 'ml' && parsed.ml != null) return parsed.ml
  if (parsed.quantity != null && parsed.unit === unit) return parsed.quantity
  return null
}

function guessUnit(parsed) {
  if (parsed.unit && KNOWN_UNITS.includes(parsed.unit)) return parsed.unit
  if (parsed.ml != null) return 'ml'
  if (parsed.grams != null) return 'g'
  return '個'
}

function round(n) {
  return Math.round(n * 100) / 100
}

// 決めた保存先で、必要量を計算する。食材の単位に直せる根拠(g・ml・大さじ、同じ単位)があるときだけ数にし、
// それ以外(「1パック」「少々」「150〜200g」)は数を空にして、元の分量の表記(amountText)のまま保存する。換算は推測しない
function withQuantity(target, parsed) {
  // 幅(150〜200g)や、複数の食材に共通かどうか分からない分量は、数に決めない
  const uncertain = Boolean(parsed.range) || Boolean(parsed.sharedUnknown)
  const q = uncertain ? null : quantityInUnit(parsed, target.unit)
  return {
    ...target,
    requiredQuantity: q != null ? round(q) : '',
    // 数に決められなかった(少々・適量は、量を量らないので確認の対象にしない)
    quantityUnknown: q == null && !parsed.vague,
    needsCheck: q == null && !parsed.vague,
  }
}

function amountTextOf(parsed) {
  if (parsed.sharedUnknown) return parsed.splitFrom ? `${parsed.amountText}(${parsed.splitFrom} の一部)`.slice(0, 60) : parsed.amountText
  return parsed.amountText || (parsed.vague ? '適量' : '')
}

// 取り込んだ材料1行を照合する。
// - 食材が決まったもの(食材マスタ・冷蔵庫・別の食材としての新規登録)は、そのまま保存できる
// - 候補から選ぶもの(needsChoice)も、確認待ちとして保存できる(あとで詳細画面で選ぶ)
export function resolveIngredient(parsed, ingredients, catalog, aliases = [], index = buildNameIndex({ ingredients, catalog, aliases })) {
  const match = matchIngredientName(parsed.name, index, { notes: parsed.notes ?? [] })
  const target =
    match.status === 'auto'
      ? match.option
      : { kind: 'new', name: match.newName || displayName(parsed.name), unit: guessUnit(parsed) }
  return {
    ...withQuantity(target, parsed),
    // 取り込んだときの名前と解析結果(どの食材かを選び直したときに、必要量を計算し直し、別名として覚える)
    sourceName: displayName(parsed.name),
    parsed,
    amountText: amountTextOf(parsed),
    note: match.note ?? null,
    candidates: match.candidates,
    // 似た候補があって決めきれない: 確認待ちとして保存し、あとで選ぶ(保存は妨げない)
    needsChoice: match.status === 'choose',
    choiceReason: match.reason ?? null,
    // 水・お湯・揚げ油などは在庫で管理しない(最初は保存しない)。少々・適量は元の表記のまま保存する
    include: Boolean(parsed.name) && !isNotStocked(parsed.name),
  }
}

// どの食材かを選んだとき(候補 / 新しい食材 / ほかの食材)。候補やほかの食材を選んだら、取り込んだ表記を別名として覚える
export function applyChoice(item, option) {
  const parsed = item.parsed ?? { name: item.sourceName ?? item.name, quantity: Number(item.requiredQuantity) || null, unit: item.unit, amountText: item.amountText ?? '' }
  const target =
    option.kind === 'new'
      ? { kind: 'new', name: item.sourceName ?? item.name, unit: guessUnit(parsed) }
      : option.kind === 'existing'
        ? { kind: 'existing', ingredient: option.ingredient, name: option.ingredient.name, unit: option.ingredient.unit }
        : { kind: 'catalog', catalogItem: option.catalogItem, name: option.catalogItem.name, unit: option.catalogItem.unit }
  const catalogId = option.kind === 'existing' ? option.ingredient.catalog_id : option.kind === 'catalog' ? option.catalogItem.id : null
  const alias = item.sourceName
  const learn = option.kind !== 'new' && alias && catalogId && normalizeName(alias) !== normalizeName(target.name)
  const next = { ...item, ...withQuantity(target, parsed), include: true, needsChoice: false, learnAlias: learn ? { alias, catalogId } : undefined }
  if (option.kind !== 'catalog') delete next.catalogItem
  if (option.kind !== 'existing') delete next.ingredient
  return next
}

// 同じ保存先(冷蔵庫の食材・マスタ・新しい名前)に向かう行を1つにまとめる。
// 数がそろっていれば足し、1つでも数が分からなければ合計も分からない(元の分量の表記をつなぐ)。確認待ちの行はまとめない
export function mergeResolved(rows) {
  const merged = new Map()
  let pending = 0
  for (const row of rows) {
    if (!row.include) continue
    const key = row.needsChoice
      ? `p:${pending++}`
      : row.kind === 'existing'
        ? `i:${row.ingredient.id}`
        : row.kind === 'catalog'
          ? `c:${row.catalogItem.id}`
          : `n:${normalizeName(row.name)}`
    const qty = Number(row.requiredQuantity)
    const known = qty > 0
    const prev = merged.get(key)
    if (prev) {
      // 単位が違う(新しい食材で、分量の表記から推定した単位が行ごとに違う)なら、足さずに分からないものとする
      prev.requiredQuantity = prev.requiredQuantity !== '' && known && prev.unit === row.unit ? round(prev.requiredQuantity + qty) : ''
      prev.amountText = [prev.amountText, row.amountText].filter(Boolean).join(' + ').slice(0, 60)
      prev.note = [...new Set([prev.note, row.note].filter(Boolean))].join('・') || null
      if (row.key) prev.memberKeys.push(row.key)
    } else {
      // memberKeys: まとめた元の行(手順で使う材料を、保存先の食材に結び付けるため)
      merged.set(key, { ...row, requiredQuantity: known ? qty : '', memberKeys: row.key ? [row.key] : [] })
    }
  }
  return [...merged.values()]
}

// 取り込んだ材料の行の一覧を、見出しの除外 → 複数の食材の分割 → 照合 の順に処理する(取り込み画面と検証で共通)
export function importIngredientLines(lines, { ingredients = [], catalog = [], aliases = [], index } = {}) {
  const idx = index ?? buildNameIndex({ ingredients, catalog, aliases })
  const out = []
  for (const raw of lines) {
    if (isHeadingLine(raw)) {
      out.push({ raw, heading: true })
      continue
    }
    for (const parsed of splitIngredientLine(parseIngredientLine(raw))) {
      out.push({ raw, item: { rawText: raw, ...resolveIngredient(parsed, ingredients, catalog, aliases, idx) } })
    }
  }
  return out
}
