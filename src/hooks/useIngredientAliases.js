import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { useSharedKitchen } from '@/hooks/kitchenData'
import { ALIASES_CHANGED } from '@/lib/aliasEvents'
import { getActiveGroupId } from '@/lib/activeGroup'
import { filterHouse } from '@/lib/houseScope'

// 食材の別名辞書(共通 + 自分の家庭)。表記の違い(人参 → にんじん)を食材マスタの1品目にまとめる
export function useIngredientAliases() {
  const shared = useSharedKitchen('aliases')
  const own = useIngredientAliasesSource(shared ? undefined : getActiveGroupId(), !shared)
  return shared ?? own
}

// 共通の別名と、選んでいる家の別名だけ(ほかの家で覚えた別名は使わない)
export function useIngredientAliasesSource(groupId, enabled = true) {
  const [aliases, setAliases] = useState([])

  const refresh = useCallback(async () => {
    if (!enabled) return
    const { data, error } = await supabase.from('ingredient_aliases').select('alias, catalog_id, group_id')
    if (error) console.error('食材の別名の取得に失敗しました', error)
    setAliases(filterHouse(data, groupId))
  }, [enabled, groupId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!enabled) return undefined
    window.addEventListener(ALIASES_CHANGED, refresh)
    return () => window.removeEventListener(ALIASES_CHANGED, refresh)
  }, [enabled, refresh])

  return useMemo(() => ({ aliases, refresh }), [aliases, refresh])
}
