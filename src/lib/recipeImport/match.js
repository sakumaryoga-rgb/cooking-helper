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

// 決めた保存先で、必要量と確認の要否を計算する。単位が食い違うときは換算せず(根拠のない換算をしない)、
// 分量を空にして入力してもらう。g・ml は、材料の行に書かれた g・ml・大さじ などの表記からだけ求める
function withQuantity(target, parsed) {
  // 幅(150〜200g)や、複数の食材に共通かどうか分からない分量は、決めずに入れてもらう
  const uncertain = Boolean(parsed.range) || Boolean(parsed.sharedUnknown)
  const q = uncertain ? null : quantityInUnit(parsed, target.unit)
  return {
    ...target,
    requiredQuantity: q != null ? round(q) : '',
    needsCheck: q == null && !parsed.vague,
  }
}

function newOption(parsed) {
  return { kind: 'new', name: displayName(parsed.name), unit: guessUnit(parsed) }
}

// 取り込んだ材料1行を照合する(A: 自動で確定 / B: 候補から選ぶ / C: 新しい食材)
export function resolveIngredient(parsed, ingredients, catalog, aliases = [], index = buildNameIndex({ ingredients, catalog, aliases })) {
  const match = matchIngredientName(parsed.name, index, { notes: parsed.notes ?? [] })
  const target = match.status === 'auto' ? match.option : newOption(parsed)
  return {
    ...withQuantity(target, parsed),
    // 取り込んだときの名前と解析結果(どの食材かを選び直したときに、必要量を計算し直し、別名として覚える)
    sourceName: displayName(parsed.name),
    parsed,
    candidates: match.candidates,
    // 決めきれない(状態の修飾・部分一致・候補が複数): ユーザーが選ぶまで保存しない
    needsChoice: match.status === 'choose',
    choiceReason: match.reason ?? null,
    // 「適量」「少々」は必要量を決められないので、最初は保存しない
    include: !parsed.vague && Boolean(parsed.name) && !isNotStocked(parsed.name),
  }
}

// どの食材かを選んだとき(候補 / 新しい食材 / ほかの食材)。候補やほかの食材を選んだら、取り込んだ表記を別名として覚える
export function applyChoice(item, option) {
  const parsed = item.parsed ?? { name: item.sourceName ?? item.name, quantity: Number(item.requiredQuantity) || null, unit: item.unit }
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

// 同じ保存先(冷蔵庫の食材・マスタ・新しい名前)に向かう行を1つにまとめ、必要量を足す
export function mergeResolved(rows) {
  const merged = new Map()
  for (const row of rows) {
    if (!row.include) continue
    const key = row.kind === 'existing' ? `i:${row.ingredient.id}` : row.kind === 'catalog' ? `c:${row.catalogItem.id}` : `n:${normalizeName(row.name)}:${row.unit}`
    const qty = Number(row.requiredQuantity)
    const prev = merged.get(key)
    if (prev) prev.requiredQuantity = round(prev.requiredQuantity + (qty > 0 ? qty : 0))
    else merged.set(key, { ...row, requiredQuantity: qty > 0 ? qty : 0 })
  }
  return [...merged.values()].filter((r) => r.requiredQuantity > 0)
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
