import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { CONSENT_REQUIRED, LEGAL_VERSIONS } from '@/lib/legal'

// 利用規約とプライバシーポリシーへの同意(BASKETBALL STATS と同じ流れ)。
// - 初めて開いたとき(ログインの前)に同意画面を出し、同意を端末に記録する(版ごと。改定したら出し直す)。
// - ログインしたら、同意の記録をサーバー(user_consents)にも残す。サーバーに残せなくても利用は止めない(端末に記録済み)。
export const CONSENT_KEY = 'cookdoor:consent'
const CURRENT = `${LEGAL_VERSIONS.terms}/${LEGAL_VERSIONS.privacy}`

function readLocal() {
  try {
    return localStorage.getItem(CONSENT_KEY)
  } catch {
    return null
  }
}

async function recordOnServer() {
  const { data, error } = await supabase.from('user_consents').select('document, version')
  if (error) throw error
  for (const [document, version] of Object.entries(LEGAL_VERSIONS)) {
    if ((data ?? []).some((c) => c.document === document && c.version === version)) continue
    const { error: insertError } = await supabase.from('user_consents').insert({ document, version })
    // 23505 = すでに同じ版に同意済み(別の端末など)
    if (insertError && insertError.code !== '23505') throw insertError
  }
}

export function useConsent(userId, { required = CONSENT_REQUIRED } = {}) {
  const [stored, setStored] = useState(() => readLocal())
  const agreed = !required || stored === CURRENT

  // ログインしていて端末で同意済みなら、サーバーにも記録する(ログインの前に同意した場合など)
  useEffect(() => {
    if (!required || !userId || stored !== CURRENT) return
    recordOnServer().catch((e) => console.error('同意の記録をサーバーに残せませんでした(端末には記録済みです)', e))
  }, [required, userId, stored])

  const agree = useCallback(async () => {
    try {
      localStorage.setItem(CONSENT_KEY, CURRENT)
    } catch {
      /* 端末に保存できなくても、この画面では同意したものとして進める */
    }
    setStored(CURRENT)
    return {}
  }, [])

  return { loading: false, needsConsent: !agreed, revised: !agreed && Boolean(stored), loadError: false, agree, retry: () => {} }
}
