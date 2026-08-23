import { useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

// 食材マスタ(全ユーザー共通・グループに紐付かない参照データ)を一度だけ取得する
export function useIngredientCatalog() {
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      const { data, error } = await supabase
        .from('ingredient_catalog')
        .select('id, name, unit, category, sort_order')
        .order('sort_order')

      if (error) console.error('食材マスタの取得に失敗しました', error)
      if (active) {
        setCatalog(data ?? [])
        setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [])

  return { catalog, loading }
}
