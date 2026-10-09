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
    async (preferId = null) => {
      if (!userId) {
        setActiveGroupId(null)
        setGroups([])
        setGroup(null)
        setLoading(false)
        return
      }
      setLoading(true)
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
