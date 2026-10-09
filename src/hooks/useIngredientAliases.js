import { useEffect, useMemo, useState } from 'react'
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

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    supabase
      .from('ingredient_aliases')
      .select('alias, catalog_id, group_id')
      .then(({ data, error }) => {
        if (error) console.error('食材の別名の取得に失敗しました', error)
        if (!cancelled) setAliases(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return useMemo(() => ({ aliases }), [aliases])
}
