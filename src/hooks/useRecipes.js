import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { debounce, useSharedKitchen } from '@/hooks/kitchenData'

const RECIPE_SELECT =
  '*, recipe_ingredients(id, ingredient_id, required_quantity, raw_text, ingredient:ingredients(id, name, unit))'

// グループの保存レシピ一覧を取得し、他メンバーの変更をリアルタイムに反映する
export function useRecipes(groupId) {
  const shared = useSharedKitchen('recipes', groupId)
  const own = useRecipesSource(shared ? null : groupId)
  return shared ?? own
}

export function useRecipesSource(groupId) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const loaded = useRef(false)

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRecipes([])
      setLoading(false)
      return
    }

    if (!loaded.current) setLoading(true)
    const { data, error } = await supabase
      .from('recipes')
      .select(RECIPE_SELECT)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })

    if (error) console.error('レシピ一覧の取得に失敗しました', error)
    if (!error) loaded.current = true
    setRecipes(data ?? [])
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!groupId) return

    const reload = debounce(refresh)
    const channel = supabase
      .channel(`recipes-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recipes', filter: `group_id=eq.${groupId}` },
        () => reload()
      )
      // recipe_ingredients には group_id 列がないため直接フィルタできない。
      // RLSにより自分のグループの行しか届かないので、フィルタなしで購読してよい。
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_ingredients' }, () =>
        reload()
      )
      .subscribe()

    return () => {
      reload.cancel()
      supabase.removeChannel(channel)
    }
  }, [groupId, refresh])

  return useMemo(() => ({ recipes, loading, refresh }), [recipes, loading, refresh])
}
