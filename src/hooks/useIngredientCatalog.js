import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { getActiveGroupId } from '@/lib/activeGroup'
import { eventInHouse, filterHouse } from '@/lib/houseScope'
import { debounce, resyncOnRejoin, useSharedKitchen } from '@/hooks/kitchenData'

// 食材マスタ(共通の品目 + 選んでいる家の品目)を取得し、
// 他メンバーの追加・カテゴリ変更・削除をリアルタイムに反映する。別の家の品目は使わない
export function useIngredientCatalog() {
  const shared = useSharedKitchen('catalog')
  const own = useIngredientCatalogSource(shared ? undefined : getActiveGroupId(), !shared)
  return shared ?? own
}

export function useIngredientCatalogSource(groupId, enabled = true) {
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const { data, error } = await supabase
      .from('ingredient_catalog')
      .select('id, name, unit, category, sort_order, shelf_life_days, group_id')
      .order('sort_order')

    if (error) console.error('食材マスタの取得に失敗しました', error)
    // 所属しているほかの家の品目は除く(読み取りの権限は所属している家すべて。migration 029)
    setCatalog(filterHouse(data, groupId))
    setLoading(false)
  }, [enabled, groupId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    // このフックは同時に複数箇所(Fridge/IngredientPicker等)から呼ばれるため、
    // 固定チャンネル名だと2つ目のsubscribe()が
    // 「cannot add postgres_changes callbacks after subscribe()」で例外になる。
    // 呼び出しごとに一意な名前を使い、チャンネルが衝突しないようにする。
    if (!enabled) return undefined
    const reload = debounce(refresh)
    const channel = supabase
      .channel(`ingredient-catalog-${Math.random().toString(36).slice(2)}`)
      // ほかの家の品目の変更では読み直さない
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredient_catalog' }, (payload) => {
        if (eventInHouse(payload, groupId)) reload()
      })
      .subscribe(resyncOnRejoin(reload))

    return () => {
      reload.cancel()
      supabase.removeChannel(channel)
    }
  }, [refresh, enabled, groupId])

  return useMemo(() => ({ catalog, loading, refresh }), [catalog, loading, refresh])
}
