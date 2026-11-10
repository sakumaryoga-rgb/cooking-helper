// レシピの材料の編集中の行(RecipeItemsEditor の items)についての判定(編集画面と保存の確認で共通)
import { guessCategory } from '@/lib/ingredientCategory'
import { normalizeName } from '@/lib/recipeImport/match'

export const VAGUE_AMOUNT = '適量'
// 適量には、どのくらいかのメモ(200g・大さじ1 など)を付けられる。「適量(200g)」の形で amount_text に保存する
// (在庫の計算では、ほかの適量と同じく「在庫があれば足りる」とみなす)
const VAGUE_WITH_MEMO = /^適量[(（](.*)[)）]$/
export const isVagueText = (text) => text === VAGUE_AMOUNT || VAGUE_WITH_MEMO.test(text ?? '')
export const isVagueAmount = (item) => isVagueText(item.amountText) && !(Number(item.requiredQuantity) > 0)
export const vagueMemo = (text) => (text ?? '').match(VAGUE_WITH_MEMO)?.[1] ?? ''
export const vagueText = (memo) => {
  const m = String(memo ?? '').trim().slice(0, 50)
  return m ? `${VAGUE_AMOUNT}(${m})` : VAGUE_AMOUNT
}
// メモの単位(g・大さじ・小さじ)。大さじ・小さじは数の前、g は数の後ろに付ける
export const MEMO_UNITS = ['g', '大さじ', '小さじ']
export function memoText(count, unit) {
  const c = String(count ?? '').trim()
  if (!c) return ''
  return unit === 'g' ? `${c}g` : `${unit}${c}`
}
// 「200g」「大さじ1」を数と単位に分ける(ほかの書き方なら null)
export function parseMemo(memo) {
  const m = String(memo ?? '').match(/^(大さじ|小さじ)\s*([\d.\/]+)$/) ?? null
  if (m) return { unit: m[1], count: m[2] }
  const g = String(memo ?? '').match(/^([\d.\/]+)\s*g$/i)
  return g ? { unit: 'g', count: g[1] } : null
}

// 調味料(食材マスタのカテゴリ「調味料・油」)か。確認待ち(どの食材か未確定)の行は false
export function isSeasoningItem(item, catalogById = new Map()) {
  if (item.needsChoice) return false
  if (item.kind === 'existing' && item.ingredient) {
    return (catalogById.get(item.ingredient.catalog_id)?.category ?? guessCategory(item.ingredient.name)) === '調味料・油'
  }
  if (item.kind === 'catalog' && item.catalogItem) return (item.catalogItem.category ?? guessCategory(item.catalogItem.name)) === '調味料・油'
  if (item.kind === 'new') return guessCategory(item.name) === '調味料・油'
  return false
}

// 材料の冷蔵庫の行(この家にまだなければ null)。保存のときと同じく、食材マスタの品目か名前で探す
export function fridgeRowOfItem(item, ingredients = []) {
  if (item.kind === 'existing') return ingredients.find((i) => i.id === item.ingredient?.id) ?? item.ingredient ?? null
  if (item.kind === 'catalog') {
    return ingredients.find((i) => i.catalog_id === item.catalogItem?.id || normalizeName(i.name) === normalizeName(item.catalogItem?.name ?? '')) ?? null
  }
  return ingredients.find((i) => normalizeName(i.name) === normalizeName(item.name)) ?? null
}
