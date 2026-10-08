import { useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

// 食材の別名辞書(共通 + 自分の家庭)。表記の違い(人参 → にんじん)を食材マスタの1品目にまとめる
export function useIngredientAliases() {
  const [aliases, setAliases] = useState([])

  useEffect(() => {
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
  }, [])

  return { aliases }
}
