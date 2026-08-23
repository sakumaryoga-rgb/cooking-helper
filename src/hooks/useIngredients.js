import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

// グループの冷蔵庫の中身を取得し、他メンバーの変更をリアルタイムに反映する
export function useIngredients(groupId) {
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!groupId) {
      setIngredients([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('ingredients')
      .select('*')
      .eq('group_id', groupId)
      .order('name')

    if (error) console.error('食材一覧の取得に失敗しました', error)
    setIngredients(data ?? [])
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 体感速度優先で即座にローカルから消し、DB削除が失敗した場合だけ再取得して戻す
  const removeIngredient = useCallback(
    async (id) => {
      setIngredients((prev) => prev.filter((i) => i.id !== id))
      const { error } = await supabase.from('ingredients').delete().eq('id', id)
      if (error) {
        console.error('食材の削除に失敗しました', error)
        refresh()
      }
    },
    [refresh]
  )

  useEffect(() => {
    if (!groupId) return

    const channel = supabase
      .channel(`ingredients-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingredients', filter: `group_id=eq.${groupId}` },
        () => refresh()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId, refresh])

  return { ingredients, loading, refresh, removeIngredient }
}
