import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { useSharedKitchen } from '@/hooks/kitchenData'

// 家庭で覚えた分量の換算(「豚こま切れ肉 1パック = 200g」)。Map<`${ingredientId}:${unit}`, 食材の単位での量>
export function useUnitConversions(groupId) {
  const shared = useSharedKitchen('conversions', groupId)
  const own = useUnitConversionsSource(shared ? null : groupId)
  return shared ?? own
}

export function useUnitConversionsSource(groupId) {
  const [rows, setRows] = useState([])

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRows([])
      return
    }
    // 選んでいる家の食材の換算だけ(RLS では所属するすべての家の換算が読めるため)
    const { data, error } = await supabase
      .from('ingredient_unit_conversions')
      .select('ingredient_id, unit, amount, ingredients!inner(group_id)')
      .eq('ingredients.group_id', groupId)
    if (error) {
      // migration 024 の適用前は表がない: 換算なしで動く
      if (error.code !== '42P01' && error.code !== 'PGRST205') console.error('分量の換算の取得に失敗しました', error)
      setRows([])
      return
    }
    setRows(data ?? [])
  }, [groupId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 確定した換算を覚える(調理のときにユーザーが入れた量から)
  const remember = useCallback(
    async (ingredientId, unit, amount) => {
      if (!ingredientId || !unit || !(amount > 0)) return false
      const { error } = await supabase
        .from('ingredient_unit_conversions')
        .upsert({ ingredient_id: ingredientId, unit, amount, updated_at: new Date().toISOString() })
      if (error) {
        console.error('分量の換算を覚えられませんでした', error)
        return false
      }
      await refresh()
      return true
    },
    [refresh]
  )

  const conversions = useMemo(() => new Map(rows.map((r) => [`${r.ingredient_id}:${r.unit}`, Number(r.amount)])), [rows])
  return useMemo(() => ({ conversions, rows, refresh, remember }), [conversions, rows, refresh, remember])
}
