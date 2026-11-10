// レシピの材料の編集中の行(RecipeItemsEditor の items)についての判定(編集画面と保存の確認で共通)
import { guessCategory } from '@/lib/ingredientCategory'
import { normalizeName } from '@/lib/recipeImport/match'

export const VAGUE_AMOUNT = '適量'
export const isVagueAmount = (item) => item.amountText === VAGUE_AMOUNT && !(Number(item.requiredQuantity) > 0)

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
