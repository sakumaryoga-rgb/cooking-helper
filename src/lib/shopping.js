import { supabase } from '@/supabaseClient'

// 買い物リスト(migration 027)。利用者が「なくなった」とマークした常備品だけが入る。
// 在庫が0になった食材を自動では入れない。買ったら外す(常備品なので数量は変えない)
export function shoppingItems(ingredients) {
  return (ingredients ?? [])
    .filter((i) => i.restock_requested_at)
    .sort((a, b) => String(a.restock_requested_at).localeCompare(String(b.restock_requested_at)))
}

function friendly(error) {
  // migration 027 の適用前は列がない
  if (error?.code === '42703' || error?.code === 'PGRST204') return '買い物リストの準備ができていません。しばらくしてからお試しください'
  return '買い物リストを更新できませんでした。もう一度お試しください'
}

export async function addToShoppingList(ids) {
  if (!ids?.length) return {}
  const { error } = await supabase.from('ingredients').update({ restock_requested_at: new Date().toISOString() }).in('id', ids)
  if (error) {
    console.error('買い物リストに入れられませんでした', error)
    return { error: friendly(error) }
  }
  return {}
}

export async function markBought(id) {
  const { error } = await supabase.from('ingredients').update({ restock_requested_at: null }).eq('id', id)
  if (error) {
    console.error('買い物リストから外せませんでした', error)
    return { error: friendly(error) }
  }
  return {}
}
