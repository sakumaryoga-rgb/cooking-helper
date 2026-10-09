import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { useSharedKitchen } from '@/hooks/kitchenData'

// 食材の別名辞書(共通 + 自分の家庭)。表記の違い(人参 → にんじん)を食材マスタの1品目にまとめる
export function useIngredientAliases() {
  const shared = useSharedKitchen('aliases')
  const own = useIngredientAliasesSource(!shared)
  return shared ?? own
}

export function useIngredientAliasesSource(enabled = true) {
  const [aliases, setAliases] = useState([])

  const refresh = useCallback(async () => {
    if (!enabled) return
    const { data, error } = await supabase.from('ingredient_aliases').select('alias, catalog_id, group_id')
    if (error) console.error('食材の別名の取得に失敗しました', error)
    setAliases(data ?? [])
  }, [enabled])

  useEffect(() => {
    refresh()
  }, [refresh])

  return useMemo(() => ({ aliases, refresh }), [aliases, refresh])
}
