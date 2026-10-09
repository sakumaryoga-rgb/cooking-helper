import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { takePendingInvite } from '@/lib/invite'

export const INVITE_MESSAGES = {
  invalid: '招待リンクが無効か、期限が切れています。グループのメンバーに新しい招待リンクを発行してもらってください',
  legacy: 'この招待リンクは古い形式のため使えません。グループのメンバーに新しい招待リンクを発行してもらってください',
  failed: '招待先の家に参加できませんでした。通信状況を確かめて、招待リンクをもう一度開いてください',
}

// ログイン後に、開いていた招待リンク(端末に保持したトークン)で招待先の家に参加し、その家を選ぶ。
// 既存の家やデータには触れない(招待先のメンバーとして追加するだけ)。
export function usePendingInvite({ ready, onJoined }) {
  const [notice, setNotice] = useState(null) // { kind: 'joined' | 'error', text }
  const running = useRef(false)

  useEffect(() => {
    if (!ready || running.current) return
    const { token, legacy } = takePendingInvite()
    if (!token) {
      if (legacy) setNotice({ kind: 'error', text: INVITE_MESSAGES.legacy })
      return
    }
    running.current = true
    ;(async () => {
      const { data, error } = await supabase.rpc('join_group_with_invite', { p_token: token })
      running.current = false
      if (error) {
        setNotice({ kind: 'error', text: error.message?.startsWith('招待リンク') ? error.message : INVITE_MESSAGES.failed })
        return
      }
      if (!data?.id) {
        setNotice({ kind: 'error', text: INVITE_MESSAGES.invalid })
        return
      }
      await onJoined(data.id)
      setNotice({ kind: 'joined', text: `「${data.name}」に参加しました。この家に切り替えています` })
    })()
  }, [ready, onJoined])

  return { notice, dismiss: () => setNotice(null) }
}
