import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

// 代替ルール(共通 + 自分の家庭)と、家庭で使わないことにしたルール。
// 判定に使うのは「使わない」に入っていないルールだけ
export function useSubstitutions(groupId) {
  const [rules, setRules] = useState([])
  const [optOutIds, setOptOutIds] = useState(() => new Set())

  const refresh = useCallback(async () => {
    const [{ data: ruleRows, error: ruleError }, { data: optRows, error: optError }] = await Promise.all([
      supabase.from('ingredient_substitutions').select('id, from_catalog_id, to_catalog_id, ratio, note, group_id'),
      supabase.from('substitution_opt_outs').select('substitution_id'),
    ])
    if (ruleError || optError) console.error('代替ルールの取得に失敗しました', ruleError ?? optError)
    setRules(ruleRows ?? [])
    setOptOutIds(new Set((optRows ?? []).map((r) => r.substitution_id)))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const enabledRules = useMemo(() => rules.filter((r) => !optOutIds.has(r.id)), [rules, optOutIds])
  const disabledRules = useMemo(() => rules.filter((r) => optOutIds.has(r.id)), [rules, optOutIds])

  const disableRule = useCallback(
    async (ruleId) => {
      setOptOutIds((prev) => new Set(prev).add(ruleId))
      const { error } = await supabase.from('substitution_opt_outs').insert({ group_id: groupId, substitution_id: ruleId })
      if (error && error.code !== '23505') {
        console.error('代替ルールの無効化に失敗しました', error)
        refresh()
      }
    },
    [groupId, refresh]
  )

  const enableRule = useCallback(
    async (ruleId) => {
      setOptOutIds((prev) => {
        const next = new Set(prev)
        next.delete(ruleId)
        return next
      })
      const { error } = await supabase.from('substitution_opt_outs').delete().eq('substitution_id', ruleId)
      if (error) {
        console.error('代替ルールを戻せませんでした', error)
        refresh()
      }
    },
    [refresh]
  )

  return { rules: enabledRules, disabledRules, disableRule, enableRule }
}
