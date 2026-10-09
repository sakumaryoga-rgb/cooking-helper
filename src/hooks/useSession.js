import { useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { handleSignedOut } from '@/lib/sessionNotice'

// 現在のログイン状態(セッション)を監視する。
// セッションは supabase-js が端末に保存し、ブラウザの再起動・再読み込み・PWA の更新の後も getSession で復元する。
// アクセストークンは自動で更新される。更新できなくなった場合(他の端末からの全端末サインアウトなど)は
// SIGNED_OUT になり、ログイン画面で「もう一度ログインしてください」と知らせる。
export function useSession() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') handleSignedOut()
      setSession(newSession)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  return { session, loading }
}
