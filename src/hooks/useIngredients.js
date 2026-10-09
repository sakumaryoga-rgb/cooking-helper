import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { debounce, useSharedKitchen } from '@/hooks/kitchenData'

// グループの冷蔵庫の中身を取得し、他メンバーの変更をリアルタイムに反映する
export function useIngredients(groupId) {
  const shared = useSharedKitchen('ingredients', groupId)
  const own = useIngredientsSource(shared ? null : groupId)
  return shared ?? own
}

export function useIngredientsSource(groupId) {
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const loaded = useRef(false)

  const refresh = useCallback(async () => {
    if (!groupId) {
      setIngredients([])
      setLoading(false)
      return
    }

    // 「読み込み中」は最初の1回だけ(リアルタイムの読み直しで一覧を消さない)
    if (!loaded.current) setLoading(true)
    const { data, error } = await supabase
      .from('ingredients')
      .select('*')
      .eq('group_id', groupId)
      .order('name')

    if (error) console.error('食材一覧の取得に失敗しました', error)
    if (!error) loaded.current = true
    setIngredients(data ?? [])
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 冷蔵庫から削除する。レシピで使う食材は行を残して在庫0にし(レシピの材料を消さないため)、
  // 使っていなければ行ごと消す(remove_ingredient、migration 012)。
  // 体感速度優先で、まずローカルで在庫0にする(在庫0の食材は一覧で折りたたまれる)
  const removeIngredient = useCallback(
    async (id) => {
      setIngredients((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: 0 } : i)))
      const { data: deleted, error } = await supabase.rpc('remove_ingredient', { p_ingredient_id: id })
      if (error) {
        console.error('食材の削除に失敗しました', error)
        refresh()
        return
      }
      if (deleted) setIngredients((prev) => prev.filter((i) => i.id !== id))
    },
    [refresh]
  )

  // DB 側ですでに消えた行(数量ボタンで在庫0になり自動削除された)を画面からだけ消す
  const dropLocal = useCallback((id) => {
    setIngredients((prev) => prev.filter((i) => i.id !== id))
  }, [])

  useEffect(() => {
    if (!groupId) return

    const reload = debounce(refresh)
    const channel = supabase
      .channel(`ingredients-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingredients', filter: `group_id=eq.${groupId}` },
        () => reload()
      )
      .subscribe()

    return () => {
      reload.cancel()
      supabase.removeChannel(channel)
    }
  }, [groupId, refresh])

  return useMemo(() => ({ ingredients, loading, refresh, removeIngredient, dropLocal }), [ingredients, loading, refresh, removeIngredient, dropLocal])
}
