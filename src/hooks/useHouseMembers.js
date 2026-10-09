import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

// 家のメンバー(user_id・役割・呼び名・参加日)。メールアドレスは扱わない。
// 読み取りは RLS(所属している家だけ)。選択中の家でなくても読める
export function useHouseMembers(groupId) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from('group_members')
      .select('user_id, role, display_name, joined_at')
      .eq('group_id', groupId)
      .order('joined_at')
    setMembers(data ?? [])
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('group_members')
      .select('user_id, role, display_name, joined_at')
      .eq('group_id', groupId)
      .order('joined_at')
      .then(({ data }) => {
        if (cancelled) return
        setMembers(data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [groupId])

  return { members, loading, reload }
}

// 表示名: 本人が付けた呼び名 → なければ「メンバー N」(参加順)。メールアドレスは使わない
export function memberLabel(member, index, userId) {
  if (member.display_name) return member.display_name
  return member.user_id === userId ? 'あなた' : `メンバー ${index + 1}`
}
