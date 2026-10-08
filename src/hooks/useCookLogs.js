import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

// このレシピの最近の調理記録(取り消していないもの)
export function useCookLogs(recipeId) {
  const [logs, setLogs] = useState([])

  const refresh = useCallback(async () => {
    if (!recipeId) return
    const { data, error } = await supabase
      .from('cook_logs')
      .select('id, created_at, cook_log_items(ingredient_name, used_quantity, unit, substitute_for)')
      .eq('recipe_id', recipeId)
      .is('undone_at', null)
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) console.error('調理の記録の取得に失敗しました', error)
    setLogs(data ?? [])
  }, [recipeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { logs, refresh }
}
