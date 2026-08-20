import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

// ログイン中のユーザーが所属しているグループ(世帯)情報を取得する
export function useGroup(session) {
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setGroup(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, invite_code)')
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (error) {
      console.error('グループ情報の取得に失敗しました', error)
      setGroup(null)
    } else {
      setGroup(data?.groups ?? null)
    }
    setLoading(false)
  }, [session])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { group, loading, refresh }
}
