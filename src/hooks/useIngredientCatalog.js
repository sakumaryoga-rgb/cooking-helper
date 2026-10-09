import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { debounce, useSharedKitchen } from '@/hooks/kitchenData'

// 食材マスタ(全ユーザー共通・グループに紐付かない参照データ)を取得し、
// 他メンバーの追加・カテゴリ変更・削除をリアルタイムに反映する
export function useIngredientCatalog() {
  const shared = useSharedKitchen('catalog')
  const own = useIngredientCatalogSource(!shared)
  return shared ?? own
}

export function useIngredientCatalogSource(enabled = true) {
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const { data, error } = await supabase
      .from('ingredient_catalog')
      .select('id, name, unit, category, sort_order, shelf_life_days, group_id')
      .order('sort_order')

    if (error) console.error('食材マスタの取得に失敗しました', error)
    setCatalog(data ?? [])
    setLoading(false)
  }, [enabled])

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredient_catalog' }, () => reload())
      .subscribe()

    return () => {
      reload.cancel()
      supabase.removeChannel(channel)
    }
  }, [refresh, enabled])

  return useMemo(() => ({ catalog, loading, refresh }), [catalog, loading, refresh])
}
