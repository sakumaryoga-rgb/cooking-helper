import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

// このレシピの24時間以内の調理記録(取り消していないもの)。取り消せるのは24時間以内(設計書 4 章)
export function useCookLogs(recipeId) {
  const [logs, setLogs] = useState([])

  const refresh = useCallback(async () => {
    if (!recipeId) return
    const { data, error } = await supabase
      .from('cook_logs')
      .select('id, created_at, cook_log_items(ingredient_name, used_quantity, unit, substitute_for)')
      .eq('recipe_id', recipeId)
      .is('undone_at', null)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
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
