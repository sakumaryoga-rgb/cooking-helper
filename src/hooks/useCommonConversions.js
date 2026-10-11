import { useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { indexCommonConversions } from '@/lib/unitConversion'

// 全体共通の換算の目安(migration 026)。家に関係なく同じなので、アプリを開いている間は1回だけ読む
let cache = null
let pending = null

async function load() {
  try {
    return await fetchRows()
  } catch (e) {
    // 読めなくても、目安なしで動かす(家庭の換算と計量の定義は使える)
    console.error('分量の目安の取得に失敗しました', e)
    pending = null
    return new Map()
  }
}

async function fetchRows() {
  const { data, error } = await supabase
    .from('ingredient_catalog_unit_conversions')
    .select('catalog_id, from_unit, from_quantity, to_unit, to_quantity, min_quantity, max_quantity, state_key, weight_basis, usage_policy, source_id, source_url')
  if (error) {
    // migration 026 の適用前は表がない: 目安なしで動く(家庭の換算と計量の定義だけを使う)
    if (error.code !== '42P01' && error.code !== 'PGRST205') console.error('分量の目安の取得に失敗しました', error)
    return new Map()
  }
  return indexCommonConversions(data)
}

export function useCommonConversions() {
  const [common, setCommon] = useState(() => cache ?? new Map())
  useEffect(() => {
    if (cache) return
    let alive = true
    pending ??= load().then((m) => {
      if (m.size > 0) cache = m
      return m
    })
    pending.then((m) => alive && setCommon(m))
    return () => {
      alive = false
    }
  }, [])
  return common
}

export function __resetCommonConversionsForTests() {
  cache = null
  pending = null
}
