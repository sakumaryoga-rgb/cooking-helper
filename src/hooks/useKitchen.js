import { useMemo } from 'react'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useSubstitutions } from '@/hooks/useSubstitutions'
import { useUnitConversions } from '@/hooks/useUnitConversions'
import { useIngredientBatches } from '@/hooks/useIngredientBatches'
import { sortRecipesByMakeability } from '@/lib/matching'
import { getExpiryInfo, usableIngredientsById } from '@/lib/shelfLife'

// ホーム・レシピ一覧で使う、在庫とレシピの判定(冷蔵庫の在庫が変わるとその場で更新される)
export function useKitchen(groupId) {
  const { ingredients, loading: ingredientsLoading, refresh: refreshIngredients } = useIngredients(groupId)
  const { recipes, loading: recipesLoading } = useRecipes(groupId)
  const { catalog } = useIngredientCatalog()
  const { rules: substitutions } = useSubstitutions(groupId)
  const { conversions } = useUnitConversions(groupId)

  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])
  const { batches } = useIngredientBatches(groupId)
  // 在庫のある食材ごとの、いちばん近い期限(レシピを「期限が近い食材を使う順」に並べるため)
  const expiryById = useMemo(() => {
    const byIngredient = new Map()
    for (const b of batches) {
      if (!byIngredient.has(b.ingredient_id)) byIngredient.set(b.ingredient_id, [])
      byIngredient.get(b.ingredient_id).push(b)
    }
    const map = new Map()
    for (const i of ingredients) {
      if (!(Number(i.quantity) > 0) || i.is_staple) continue
      const info = getExpiryInfo(i, byIngredient.get(i.id), catalogById)
      if (info) map.set(i.id, { daysLeft: info.daysLeft, kind: info.kind })
    }
    return map
  }, [batches, ingredients, catalogById])
  // 「作れる」の判定は、消費期限が切れたロットを除いた在庫で行う
  const usableById = useMemo(() => usableIngredientsById(ingredients, batches, catalogById), [ingredients, batches, catalogById])
  const sorted = useMemo(
    () => sortRecipesByMakeability(recipes, usableById, { substitutions, catalogById, conversions, expiryById }),
    [recipes, usableById, substitutions, catalogById, conversions, expiryById]
  )

  return {
    ingredients,
    ingredientsById,
    catalog,
    catalogById,
    recipes,
    sorted,
    loading: ingredientsLoading || recipesLoading,
    refreshIngredients,
  }
}
