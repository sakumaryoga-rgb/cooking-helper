import { mergeResolved, normalizeName } from './match'
import { guessCategory } from '@/lib/ingredientCategory'

const DUPLICATE_MESSAGE = 'このレシピはすでに保存されています'

// 食材マスタにない食材は、家庭専用の品目として登録する(冷蔵庫の「食材を選択」でカテゴリの中に出るように)
async function ensureCatalogItem(supabase, groupId, name, unit) {
  const { data: same } = await supabase.from('ingredient_catalog').select('*').eq('name', name)
  const existing = same?.find((c) => c.group_id) ?? same?.find((c) => !c.group_id)
  if (existing) return existing
  const category = guessCategory(name)
  const { data: last } = await supabase
    .from('ingredient_catalog')
    .select('sort_order')
    .eq('category', category)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data, error } = await supabase
    .from('ingredient_catalog')
    .insert({ name, unit, category, sort_order: (last?.sort_order ?? 9000) + 10, group_id: groupId })
    .select()
    .single()
  if (!error) return data
  // 同時に同じ名前が登録された
  const { data: raced } = await supabase.from('ingredient_catalog').select('*').eq('name', name)
  return raced?.find((c) => c.group_id) ?? raced?.[0] ?? null
}

// 保存先の食材(冷蔵庫の行)を用意する。ない食材は在庫0で作る(手動の材料選択と同じ扱い)。
// 冷蔵庫の行は必ず食材マスタの品目と結び付け、冷蔵庫とレシピで同じ食材として扱う
export async function ensureIngredient(supabase, groupId, row, fridge) {
  if (row.kind === 'existing') return row.ingredient.id
  const name = row.kind === 'catalog' ? row.catalogItem.name : row.name
  const found = fridge.find(
    (i) =>
      (row.kind === 'catalog' && i.catalog_id === row.catalogItem.id) ||
      normalizeName(i.name) === normalizeName(name)
  )
  if (found) return found.id

  const catalogItem = row.kind === 'catalog' ? row.catalogItem : await ensureCatalogItem(supabase, groupId, name, row.unit)
  const insert = { group_id: groupId, name: catalogItem?.name ?? name, unit: catalogItem?.unit ?? row.unit, quantity: 0 }
  // 家庭専用の品目(group_id あり)も共通の品目も、冷蔵庫の行からはマスタの ID で参照する
  if (catalogItem) insert.catalog_id = catalogItem.id
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
// 材料の行を、recipe_ingredients の行にする(新しいレシピ・カスタマイズで共通)。
// - 食材が決まった行: 冷蔵庫の行を用意して(なければ在庫0で作る)、同じ食材の行は1つにまとめる
// - 数が分からない分量(1パック・少々): required_quantity は空、元の表記を amount_text に残す(推測で換算しない)
// - 確認待ちの行(どの食材か未確定): ingredient_id は空、元の食材名を source_name に残す(あとで詳細画面で選ぶ)
async function toIngredientRows(supabase, groupId, items, fridge) {
  const rows = mergeResolved(items)
  const byIngredient = new Map()
  const pending = []
  for (const row of rows) {
    const qty = Number(row.requiredQuantity) > 0 ? Number(row.requiredQuantity) : null
    const base = {
      required_quantity: qty,
      raw_text: row.rawText ? String(row.rawText).slice(0, 200) : null,
      amount_text: row.amountText ? String(row.amountText).slice(0, 60) : null,
      note: row.note ? String(row.note).slice(0, 60) : null,
    }
    if (row.needsChoice) {
      pending.push({ ...base, ingredient_id: null, source_name: String(row.sourceName || row.name).slice(0, 80) })
      continue
    }
    const id = await ensureIngredient(supabase, groupId, row, fridge)
    const prev = byIngredient.get(id)
    if (prev) {
      prev.required_quantity = prev.required_quantity != null && qty != null ? Math.round((prev.required_quantity + qty) * 100) / 100 : null
      prev.raw_text = [prev.raw_text, base.raw_text].filter(Boolean).join(' / ').slice(0, 200) || null
      prev.amount_text = [prev.amount_text, base.amount_text].filter(Boolean).join(' + ').slice(0, 60) || null
      prev.note = [...new Set([prev.note, base.note].filter(Boolean))].join('・').slice(0, 60) || null
    } else {
      byIngredient.set(id, { ...base, ingredient_id: id, source_name: null })
    }
  }
  return [...byIngredient.values(), ...pending]
}

export async function saveRecipe({ supabase, groupId, userId, title, url, sourceKey, sourceSite, servings, items, fridge, extras = {} }) {
  if (!title.trim()) return { error: 'タイトルを入力してください' }
  if (!items.some((i) => i.include)) return { error: '材料を1つ以上追加してください' }

  let ingredientRows
  try {
    ingredientRows = await toIngredientRows(supabase, groupId, items, fridge)
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
      servings: extras.servings ?? servings ?? null,
      instructions: extras.instructions ?? null,
      memo: extras.memo ?? null,
      icon: extras.icon ?? null,
    })
    .select('id')
    .single()
  if (recipeError) {
    return { error: recipeError.code === '23505' ? DUPLICATE_MESSAGE : 'レシピの保存に失敗しました' }
  }

  const { error: riError } = await supabase.from('recipe_ingredients').insert(ingredientRows.map((r) => ({ ...r, recipe_id: recipe.id })))
  if (riError) {
    // 材料なしのレシピを残さない
    await supabase.from('recipes').delete().eq('id', recipe.id)
    return { error: '材料の保存に失敗しました' }
  }
  await learnAliases(supabase, groupId, items)
  return { recipeId: recipe.id }
}

// 取り込んだ材料を別の食材に付け替えたら、取り込んだときの表記をこの家の別名として覚える
// (次に同じ表記のレシピを取り込むと、自動でその食材になる)。覚えられなくても保存は成功のまま
export async function learnAliases(supabase, groupId, items) {
  const rows = []
  for (const item of items) {
    const alias = item.learnAlias?.alias?.trim()
    const catalogId = item.learnAlias?.catalogId
    if (!item.include || !alias || !catalogId || alias.length > 40) continue
    if (normalizeName(alias) === normalizeName(item.name)) continue
    rows.push({ group_id: groupId, catalog_id: catalogId, alias })
  }
  for (const row of rows) {
    let { error } = await supabase.from('ingredient_aliases').insert(row)
    if (error?.code === '23505') {
      // 同じ表記をこの家で別の食材として覚えていた: 新しく選んだ食材で覚え直す
      await supabase.from('ingredient_aliases').delete().eq('group_id', groupId).eq('alias', row.alias)
      ;({ error } = await supabase.from('ingredient_aliases').insert(row))
    }
    if (error) console.error('別名を覚えられませんでした', error)
  }
}

export async function findDuplicate(supabase, groupId, sourceKey) {
  if (!sourceKey) return null
  const { data } = await supabase.from('recipes').select('id, title').eq('group_id', groupId).eq('source_key', sourceKey).maybeSingle()
  return data ?? null
}

// 保存したレシピのカスタマイズ。新しい食材は先に冷蔵庫の行(在庫0)を用意し、
// レシピと材料の差し替えは update_recipe(migration 023)が1つのトランザクションで行う
export async function updateRecipe({ supabase, groupId, recipeId, title, items, fridge, extras }) {
  if (!title.trim()) return { error: '料理名を入力してください' }
  if (!items.some((i) => i.include)) return { error: '材料を1つ以上追加してください' }
  let pItems
  try {
    pItems = await toIngredientRows(supabase, groupId, items, fridge)
  } catch (e) {
    return { error: e.message }
  }
  const { error } = await supabase.rpc('update_recipe', {
    p_recipe_id: recipeId,
    p_title: title,
    p_servings: extras.servings,
    p_instructions: extras.instructions,
    p_memo: extras.memo,
    p_icon: extras.icon,
    p_items: pItems,
  })
  if (error) return { error: error.message || 'レシピを保存できませんでした' }
  await learnAliases(supabase, groupId, items)
  return { recipeId }
}
