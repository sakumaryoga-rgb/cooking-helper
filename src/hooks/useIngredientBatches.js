import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

// グループの食材ロット(数量+追加日)を取得し、他メンバーの変更をリアルタイムに反映する。
// RLSにより自分のグループの行しか届かないので、group_idでの明示的な絞り込みは不要。
export function useIngredientBatches(groupId) {
  const [batches, setBatches] = useState([])

  const refresh = useCallback(async () => {
    if (!groupId) {
      setBatches([])
      return
    }

    const { data, error } = await supabase
      .from('ingredient_batches')
      .select('id, ingredient_id, quantity, added_on, created_at')

    if (error) console.error('食材ロットの取得に失敗しました', error)
    setBatches(data ?? [])
  }, [groupId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!groupId) return

    const channel = supabase
      .channel(`ingredient-batches-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredient_batches' }, () => refresh())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId, refresh])

  return { batches, refresh }
}
