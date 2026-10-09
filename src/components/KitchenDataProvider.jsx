import { useMemo } from 'react'
import { KitchenDataContext } from '@/hooks/kitchenData'
import { useIngredientsSource } from '@/hooks/useIngredients'
import { useRecipesSource } from '@/hooks/useRecipes'
import { useIngredientBatchesSource } from '@/hooks/useIngredientBatches'
import { useIngredientCatalogSource } from '@/hooks/useIngredientCatalog'
import { useSubstitutionsSource } from '@/hooks/useSubstitutions'
import { useIngredientAliasesSource } from '@/hooks/useIngredientAliases'
import { useUnitConversionsSource } from '@/hooks/useUnitConversions'

// 選んでいる家のデータを1回だけ読み込み、リアルタイムの変更を受け取り続ける(Layout が家ごとに作り直す)
export function KitchenDataProvider({ groupId, children }) {
  const ingredients = useIngredientsSource(groupId)
  const recipes = useRecipesSource(groupId)
  const batches = useIngredientBatchesSource(groupId)
  const catalog = useIngredientCatalogSource()
  const substitutions = useSubstitutionsSource(groupId)
  const aliases = useIngredientAliasesSource()
  const conversions = useUnitConversionsSource(groupId)
  const value = useMemo(
    () => ({ groupId, ingredients, recipes, batches, catalog, substitutions, aliases, conversions }),
    [groupId, ingredients, recipes, batches, catalog, substitutions, aliases, conversions]
  )
  return <KitchenDataContext.Provider value={value}>{children}</KitchenDataContext.Provider>
}
