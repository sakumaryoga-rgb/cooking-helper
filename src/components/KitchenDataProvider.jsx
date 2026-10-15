import { useEffect, useMemo, useRef } from 'react'
import { KitchenDataContext } from '@/hooks/kitchenData'
import { useIngredientsSource } from '@/hooks/useIngredients'
import { useRecipesSource } from '@/hooks/useRecipes'
import { useIngredientBatchesSource } from '@/hooks/useIngredientBatches'
import { useIngredientCatalogSource } from '@/hooks/useIngredientCatalog'
import { useSubstitutionsSource } from '@/hooks/useSubstitutions'
import { useIngredientAliasesSource } from '@/hooks/useIngredientAliases'
import { useUnitConversionsSource } from '@/hooks/useUnitConversions'

// 画面に戻ったときの読み直しは、続けて起きても(focus と visibilitychange など)この間隔に1回だけ
const RESYNC_INTERVAL_MS = 2000

// 選んでいる家のデータを1回だけ読み込み、リアルタイムの変更を受け取り続ける(Layout が家ごとに作り直す)
export function KitchenDataProvider({ groupId, children }) {
  const ingredients = useIngredientsSource(groupId)
  const recipes = useRecipesSource(groupId)
  const batches = useIngredientBatchesSource(groupId)
  const catalog = useIngredientCatalogSource()
  const substitutions = useSubstitutionsSource(groupId)
  const aliases = useIngredientAliasesSource()
  const conversions = useUnitConversionsSource(groupId)

  // アプリに戻った・通信が戻ったときに、すべて読み直す。
  // 裏に回っている間はリアルタイムの接続が切れ、その間の家族の変更(食材の追加など)の通知は届かないため
  const refreshers = useRef([])
  refreshers.current = [ingredients.refresh, recipes.refresh, batches.refresh, catalog.refresh, aliases.refresh, conversions.refresh]
  useEffect(() => {
    let last = 0
    const resync = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - last < RESYNC_INTERVAL_MS) return
      last = now
      for (const refresh of refreshers.current) refresh?.()
    }
    document.addEventListener('visibilitychange', resync)
    window.addEventListener('focus', resync)
    window.addEventListener('online', resync)
    window.addEventListener('pageshow', resync)
    return () => {
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('focus', resync)
      window.removeEventListener('online', resync)
      window.removeEventListener('pageshow', resync)
    }
  }, [])

  // 冷蔵庫に、読み込んだ食材マスタにない品目の食材が入った(家族がリストにない食材を追加した)ら、
  // 食材マスタを読み直す(食材を選ぶ画面・カテゴリ・日持ちに出すため)。同じ品目では1回だけ
  const askedCatalog = useRef(new Set())
  const catalogIds = useMemo(() => new Set(catalog.catalog.map((c) => c.id)), [catalog.catalog])
  useEffect(() => {
    if (catalog.loading) return
    const missing = ingredients.ingredients
      .map((i) => i.catalog_id)
      .filter((id) => id && !catalogIds.has(id) && !askedCatalog.current.has(id))
    if (missing.length === 0) return
    for (const id of missing) askedCatalog.current.add(id)
    catalog.refresh()
  }, [ingredients.ingredients, catalogIds, catalog])

  const value = useMemo(
    () => ({ groupId, ingredients, recipes, batches, catalog, substitutions, aliases, conversions }),
    [groupId, ingredients, recipes, batches, catalog, substitutions, aliases, conversions]
  )
  return <KitchenDataContext.Provider value={value}>{children}</KitchenDataContext.Provider>
}
