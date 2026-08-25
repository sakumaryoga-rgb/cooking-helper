import { supabase } from '@/supabaseClient'

function todayIso() {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10)
}

// 在庫を増やす: 「追加日を購入日にする」がオンなら今日の日付で新しいロットを作り、
// オフなら日付未定のロットへまとめる(=賞味期限の目安計算からは除外される)
export async function addBatchQuantity(ingredientId, amount, { datedToday }) {
  if (datedToday) {
    const { error } = await supabase
      .from('ingredient_batches')
      .insert({ ingredient_id: ingredientId, quantity: amount, added_on: todayIso() })
    if (error) console.error('ロットの記録に失敗しました', error)
    return
  }

  const { data: existingList } = await supabase
    .from('ingredient_batches')
    .select('id, quantity')
    .eq('ingredient_id', ingredientId)
    .is('added_on', null)
    .order('created_at', { ascending: true })
    .limit(1)

  const existing = existingList?.[0]

  if (existing) {
    const { error } = await supabase
      .from('ingredient_batches')
      .update({ quantity: Number(existing.quantity) + amount })
      .eq('id', existing.id)
    if (error) console.error('ロットの記録に失敗しました', error)
    return
  }

  const { error } = await supabase
    .from('ingredient_batches')
    .insert({ ingredient_id: ingredientId, quantity: amount, added_on: null })
  if (error) console.error('ロットの記録に失敗しました', error)
}

// 在庫を減らす: 古いロットから順に消費する(FIFO)。日付未定のロットは
// (年代不明で安全側に倒すため)日付付きロットより先に消費する。
export async function consumeBatchQuantity(ingredientId, amount) {
  let remaining = amount
  const { data: batchList, error } = await supabase
    .from('ingredient_batches')
    .select('id, quantity, added_on, created_at')
    .eq('ingredient_id', ingredientId)
    .gt('quantity', 0)
    .order('added_on', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('ロットの取得に失敗しました', error)
    return
  }

  for (const batch of batchList ?? []) {
    if (remaining <= 0) break
    const batchQuantity = Number(batch.quantity)
    if (batchQuantity <= remaining) {
      remaining -= batchQuantity
      await supabase.from('ingredient_batches').delete().eq('id', batch.id)
    } else {
      await supabase
        .from('ingredient_batches')
        .update({ quantity: batchQuantity - remaining })
        .eq('id', batch.id)
      remaining = 0
    }
  }
}
