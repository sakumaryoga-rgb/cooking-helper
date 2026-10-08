import { mergeResolved, normalizeName } from './match'

const DUPLICATE_MESSAGE = 'このレシピはすでに保存されています'

// 保存先の食材(冷蔵庫の行)を用意する。ない食材は在庫0で作る(手動の材料選択と同じ扱い)
async function ensureIngredient(supabase, groupId, row, fridge) {
  if (row.kind === 'existing') return row.ingredient.id
  const name = row.kind === 'catalog' ? row.catalogItem.name : row.name
  const found = fridge.find(
    (i) => (row.kind === 'catalog' && i.catalog_id === row.catalogItem.id) || normalizeName(i.name) === normalizeName(name)
  )
  if (found) return found.id

  const insert = { group_id: groupId, name, unit: row.unit, quantity: 0 }
  if (row.kind === 'catalog') insert.catalog_id = row.catalogItem.id
  const { data, error } = await supabase.from('ingredients').insert(insert).select('id').single()
  if (!error) return data.id
  if (error.code === '23505') {
    // 同じ名前の食材が他の家族によって先に作られていた
    const { data: existing } = await supabase.from('ingredients').select('id').eq('group_id', groupId).eq('name', name).maybeSingle()
    if (existing) return existing.id
  }
  throw new Error('材料の保存に失敗しました')
}

// items: 画面で確認した材料(resolveIngredient の結果、または手動で選んだ食材)
export async function saveRecipe({ supabase, groupId, userId, title, url, sourceKey, sourceSite, servings, items, fridge }) {
  const rows = mergeResolved(items)
  if (!title.trim()) return { error: 'タイトルを入力してください' }
  if (rows.length === 0) return { error: '材料を1つ以上、必要な分量を入力して追加してください' }

  // 同じ食材に向かう行を、冷蔵庫の行 ID でもう一度まとめる
  const byIngredient = new Map()
  try {
    for (const row of rows) {
      const id = await ensureIngredient(supabase, groupId, row, fridge)
      const prev = byIngredient.get(id)
      const raw = row.rawText ? [row.rawText] : []
      if (prev) {
        prev.required_quantity = Math.round((prev.required_quantity + row.requiredQuantity) * 100) / 100
        prev.raw.push(...raw)
      } else {
        byIngredient.set(id, { ingredient_id: id, required_quantity: row.requiredQuantity, raw })
      }
    }
  } catch (e) {
    return { error: e.message }
  }

  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .insert({
      group_id: groupId,
      title: title.trim().slice(0, 200),
      url: url?.trim() || null,
      created_by: userId,
      source_key: sourceKey ?? null,
      source_site: sourceSite ?? null,
      servings: servings ?? null,
    })
    .select('id')
    .single()
  if (recipeError) {
    return { error: recipeError.code === '23505' ? DUPLICATE_MESSAGE : 'レシピの保存に失敗しました' }
  }

  const ingredientRows = [...byIngredient.values()].map(({ raw, ...r }) => ({
    ...r,
    recipe_id: recipe.id,
    raw_text: raw.length ? raw.join(' / ').slice(0, 200) : null,
  }))
  const { error: riError } = await supabase.from('recipe_ingredients').insert(ingredientRows)
  if (riError) {
    // 材料なしのレシピを残さない
    await supabase.from('recipes').delete().eq('id', recipe.id)
    return { error: '材料の保存に失敗しました' }
  }
  return { recipeId: recipe.id }
}

export async function findDuplicate(supabase, groupId, sourceKey) {
  if (!sourceKey) return null
  const { data } = await supabase.from('recipes').select('id, title').eq('group_id', groupId).eq('source_key', sourceKey).maybeSingle()
  return data ?? null
}
