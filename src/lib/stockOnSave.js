// レシピを保存するときの「家にある材料」(冷蔵庫にまだない材料を、冷蔵庫・常備品に入れるか選んでもらう)
import { isNotStocked } from '@/lib/ingredientName'
import { normalizeName } from '@/lib/recipeImport/match'
import { fridgeRowOfItem, isSeasoningItem } from '@/lib/recipeItems'

// 冷蔵庫にまだない材料(この家に初めて出てきた食材、または在庫0で常備品でもない食材)。
// 確認待ち(どの食材か未確定)・水など・保存時に常備品にすると決めた材料は聞かない。
// 調味料は「常備品」、それ以外は「ない」を最初に選んでおく
export function stockCandidates(items, ingredients = [], catalogById = new Map()) {
  const seen = new Set()
  const rows = []
  for (const item of items) {
    if (!item.include || item.needsChoice || item.stapleOnSave) continue
    const name = item.ingredient?.name ?? item.catalogItem?.name ?? item.name
    if (!name || isNotStocked(name)) continue
    const row = fridgeRowOfItem(item, ingredients)
    if (row && (Number(row.quantity) > 0 || row.is_staple)) continue
    const id = row?.id ?? `n:${normalizeName(name)}`
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({
      key: item.key,
      name,
      unit: row?.unit ?? item.ingredient?.unit ?? item.catalogItem?.unit ?? item.unit ?? '',
      choice: isSeasoningItem(item, catalogById) ? 'staple' : 'none',
      quantity: Number(item.requiredQuantity) > 0 ? String(item.requiredQuantity) : '1',
    })
  }
  return rows
}

// 保存した後に、選んだ材料を冷蔵庫(在庫を足す・今日買ったものとして記録)と常備品に入れる。
// ingredientIds: Map<材料の行の key, 保存先の ingredient_id>(saveRecipe の結果)。失敗した件数を返す(レシピの保存は成功のまま)
export async function applyStockChoices(supabase, rows, ingredientIds) {
  let failed = 0
  const stapleIds = []
  for (const row of rows) {
    const id = ingredientIds.get(row.key)
    if (!id || row.choice === 'none') continue
    if (row.choice === 'staple') {
      stapleIds.push(id)
      continue
    }
    const qty = Number(row.quantity)
    if (!(qty > 0)) continue
    const { error } = await supabase.rpc('adjust_stock', { p_ingredient_id: id, p_delta: qty, p_dated_today: true, p_best_before: null, p_use_by: null })
    if (error) {
      console.error('冷蔵庫に入れられませんでした', error)
      failed += 1
    }
  }
  if (stapleIds.length > 0) {
    const { error } = await supabase.from('ingredients').update({ is_staple: true }).in('id', stapleIds)
    if (error) {
      console.error('常備品にできませんでした', error)
      failed += stapleIds.length
    }
  }
  return failed
}
