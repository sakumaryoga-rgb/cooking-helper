import { supabase } from '@/supabaseClient'

// 未通知のお問い合わせの通知をサーバーに頼む。失敗してもお問い合わせは DB に保存済みなので、結果は待たない
export async function requestContactNotification() {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return { error: 'unauthorized' }
    const res = await fetch('/api/contact-notify', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => ({}))
    return res.ok ? body : { error: body.error ?? 'failed' }
  } catch {
    return { error: 'failed' }
  }
}
