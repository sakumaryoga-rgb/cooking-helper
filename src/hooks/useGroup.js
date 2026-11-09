import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { getStoredGroupId, setActiveGroupId } from '@/lib/activeGroup'
import { rememberHouses } from '@/lib/loginMemory'

// 読み込みに失敗したときの再試行の間隔(サーバーの一時的な停止・通信の切れ目)
const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000]

// ログインの有効期限が切れた(しばらく使っていなかった)ときのエラー
function isAuthExpired(error) {
  return error?.code === 'PGRST301' || error?.status === 401 || /jwt/i.test(error?.message ?? '')
}

// ログイン中のユーザーが所属している家(グループ)の一覧と、この端末で選んでいる家
// - 読み込みに失敗しても「家がない(オンボーディング)」にはしない。error を返して自動で再試行する
// - この端末で選んだ家がなく、家が2つ以上あるときは needsChoice(ログイン直後にどの家に入るか選んでもらう)
export function useGroup(session) {
  const userId = session?.user?.id ?? null
  const [groups, setGroups] = useState([])
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [needsChoice, setNeedsChoice] = useState(false)
  const attempt = useRef(0)

  const refresh = useCallback(
    async (preferId = null, { silent = false } = {}) => {
      if (!userId) {
        setActiveGroupId(null)
        setGroups([])
        setGroup(null)
        setError(null)
        setNeedsChoice(false)
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      const query = () =>
        supabase.from('group_members').select('group_id, joined_at, groups(id, name)').eq('user_id', userId).order('joined_at')
      let { data, error: fetchError } = await query()
      if (fetchError && isAuthExpired(fetchError)) {
        // しばらく使っていなかった: ログインを更新して、もう一度だけ読む(ログイン画面には戻さない)
        await supabase.auth.refreshSession().catch(() => {})
        ;({ data, error: fetchError } = await query())
      }
      if (fetchError) {
        console.error('グループ情報の取得に失敗しました', fetchError)
        // 前に読めた家はそのまま使う。初めての読み込みで失敗したら、App が「つながりません」を出す
        setError(fetchError)
        setLoading(false)
        return
      }
      attempt.current = 0
      setError(null)
      const list = (data ?? []).map((m) => m.groups).filter(Boolean)
      rememberHouses(list)
      const stored = getStoredGroupId()
      const next =
        (preferId && list.find((g) => g.id === preferId)) || list.find((g) => g.id === stored) || (list.length === 1 ? list[0] : null)
      // 画面を描く前にヘッダーを切り替える(前の家の ID のまま問い合わせない)
      setActiveGroupId(next?.id ?? null)
      setGroups(list)
      setGroup(next)
      setNeedsChoice(!next && list.length >= 2)
      setLoading(false)
    },
    [userId]
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  // 読み込めなかったら、少しずつ間隔をあけて自動で読み直す。通信が戻ったときもすぐ読み直す
  useEffect(() => {
    if (!error || !userId) return undefined
    const delay = RETRY_DELAYS_MS[Math.min(attempt.current, RETRY_DELAYS_MS.length - 1)]
    const timer = setTimeout(() => {
      attempt.current += 1
      refresh(null, { silent: true })
    }, delay)
    const onOnline = () => refresh(null, { silent: true })
    window.addEventListener('online', onOnline)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [error, userId, refresh])

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
      setNeedsChoice(false)
    },
    [groups]
  )

  return { groups, group, loading, error, needsChoice, refresh, selectGroup }
}
