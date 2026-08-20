import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

const RECIPE_SELECT =
  '*, recipe_ingredients(id, ingredient_id, required_quantity, ingredient:ingredients(id, name, unit))'

// グループの保存レシピ一覧を取得し、他メンバーの変更をリアルタイムに反映する
export function useRecipes(groupId) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRecipes([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('recipes')
      .select(RECIPE_SELECT)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })

    if (error) console.error('レシピ一覧の取得に失敗しました', error)
    setRecipes(data ?? [])
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!groupId) return

    const channel = supabase
      .channel(`recipes-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recipes', filter: `group_id=eq.${groupId}` },
        () => refresh()
      )
      // recipe_ingredients には group_id 列がないため直接フィルタできない。
      // RLSにより自分のグループの行しか届かないので、フィルタなしで購読してよい。
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_ingredients' }, () =>
        refresh()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId, refresh])

  return { recipes, loading, refresh }
}
