import { useMemo } from 'react'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useSubstitutions } from '@/hooks/useSubstitutions'
import { useUnitConversions } from '@/hooks/useUnitConversions'
import { sortRecipesByMakeability } from '@/lib/matching'

// ホーム・レシピ一覧で使う、在庫とレシピの判定(冷蔵庫の在庫が変わるとその場で更新される)
export function useKitchen(groupId) {
  const { ingredients, loading: ingredientsLoading, refresh: refreshIngredients } = useIngredients(groupId)
  const { recipes, loading: recipesLoading } = useRecipes(groupId)
  const { catalog } = useIngredientCatalog()
  const { rules: substitutions } = useSubstitutions(groupId)
  const { conversions } = useUnitConversions(groupId)

  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])
  const sorted = useMemo(
    () => sortRecipesByMakeability(recipes, ingredientsById, { substitutions, catalogById, conversions }),
    [recipes, ingredientsById, substitutions, catalogById, conversions]
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
