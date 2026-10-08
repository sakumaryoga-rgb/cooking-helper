import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { CONSENT_REQUIRED, LEGAL_VERSIONS } from '@/lib/legal'

// 今の版の利用規約とプライバシーポリシーに同意済みか。
// - 同意画面を出すのは CONSENT_REQUIRED のときだけ(正式公開までは出さない)。
// - 同意の記録を読めなかった場合は、ログインや既存データの利用を止めないよう、同意画面を出さない。
export function useConsent(userId, { required = CONSENT_REQUIRED } = {}) {
  const [state, setState] = useState({ loading: required, needsConsent: false, revised: false })

  const refresh = useCallback(async () => {
    if (!required || !userId) {
      setState({ loading: false, needsConsent: false, revised: false })
      return
    }
    const { data, error } = await supabase.from('user_consents').select('document, version')
    if (error) {
      console.error('同意の記録を読めませんでした', error)
      setState({ loading: false, needsConsent: false, revised: false })
      return
    }
    const has = (doc) => (data ?? []).some((c) => c.document === doc && c.version === LEGAL_VERSIONS[doc])
    const needsConsent = !has('terms') || !has('privacy')
    setState({ loading: false, needsConsent, revised: needsConsent && (data ?? []).length > 0 })
  }, [required, userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const agree = useCallback(async () => {
    const rows = Object.entries(LEGAL_VERSIONS).map(([document, version]) => ({ document, version }))
    for (const row of rows) {
      const { error } = await supabase.from('user_consents').insert(row)
      // 23505 = すでに同じ版に同意済み(別の端末など)
      if (error && error.code !== '23505') return { error }
    }
    await refresh()
    return {}
  }, [refresh])

  return { ...state, agree }
}
