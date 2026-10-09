import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { pickActiveGroup, setActiveGroupId } from '@/lib/activeGroup'

// ログイン中のユーザーが所属している家(グループ)の一覧と、この端末で選んでいる家
export function useGroup(session) {
  const userId = session?.user?.id ?? null
  const [groups, setGroups] = useState([])
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(
    async (preferId = null, { silent = false } = {}) => {
      if (!userId) {
        setActiveGroupId(null)
        setGroups([])
        setGroup(null)
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      const { data, error } = await supabase
        .from('group_members')
        .select('group_id, joined_at, groups(id, name)')
        .eq('user_id', userId)
        .order('joined_at')
      if (error) {
        console.error('グループ情報の取得に失敗しました', error)
        setLoading(false)
        return
      }
      const list = (data ?? []).map((m) => m.groups).filter(Boolean)
      const next = (preferId && list.find((g) => g.id === preferId)) || pickActiveGroup(list)
      // 画面を描く前にヘッダーを切り替える(前の家の ID のまま問い合わせない)
      setActiveGroupId(next?.id ?? null)
      setGroups(list)
      setGroup(next)
      setLoading(false)
    },
    [userId]
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  // アプリに戻ったときに所属を確かめ直す(ほかの端末で脱退した・管理者に退出させられた・家が削除された場合に、
  // その家の画面を出したままにしない)。画面は読み込み中にしない
  useEffect(() => {
    if (!userId) return undefined
    function onVisible() {
      if (document.visibilityState === 'visible') refresh(null, { silent: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, userId])

  const selectGroup = useCallback(
    (id) => {
      const next = groups.find((g) => g.id === id)
      if (!next) return
      setActiveGroupId(next.id)
      setGroup(next)
    },
    [groups]
  )

  return { groups, group, loading, refresh, selectGroup }
}
