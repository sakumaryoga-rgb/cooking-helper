import { useMemo } from 'react'
import { KitchenDataContext } from '@/hooks/kitchenData'
import { useIngredientsSource } from '@/hooks/useIngredients'
import { useRecipesSource } from '@/hooks/useRecipes'
import { useIngredientBatchesSource } from '@/hooks/useIngredientBatches'
import { useIngredientCatalogSource } from '@/hooks/useIngredientCatalog'
import { useSubstitutionsSource } from '@/hooks/useSubstitutions'
import { useIngredientAliasesSource } from '@/hooks/useIngredientAliases'

// 選んでいる家のデータを1回だけ読み込み、リアルタイムの変更を受け取り続ける(Layout が家ごとに作り直す)
export function KitchenDataProvider({ groupId, children }) {
  const ingredients = useIngredientsSource(groupId)
  const recipes = useRecipesSource(groupId)
  const batches = useIngredientBatchesSource(groupId)
  const catalog = useIngredientCatalogSource()
  const substitutions = useSubstitutionsSource(groupId)
  const aliases = useIngredientAliasesSource()
  const value = useMemo(
    () => ({ groupId, ingredients, recipes, batches, catalog, substitutions, aliases }),
    [groupId, ingredients, recipes, batches, catalog, substitutions, aliases]
  )
  return <KitchenDataContext.Provider value={value}>{children}</KitchenDataContext.Provider>
}
