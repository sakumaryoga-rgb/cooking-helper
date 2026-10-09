import { describe, expect, it, vi } from 'vitest'
import { saveRecipe, updateRecipe } from './save'
import { parseIngredientLine } from './ingredientLine'
import { resolveIngredient } from './match'

// supabase-js の呼び出しを記録する最小のモック
function mockSupabase({ recipeError = null, riError = null } = {}) {
  const calls = []
  let n = 0
  const from = (table) => ({
    insert(row) {
      calls.push({ table, op: 'insert', row })
      const result =
        table === 'ingredients'
          ? { data: { id: `new-${++n}` }, error: null }
          : table === 'ingredient_catalog'
            ? { data: { id: `cat-${++n}`, ...row }, error: null }
          : table === 'ingredient_aliases'
            ? { error: null }
          : table === 'recipes'
            ? { data: recipeError ? null : { id: 'r1' }, error: recipeError }
            : { error: riError }
      const chain = { select: () => chain, single: async () => result, then: (f) => Promise.resolve(result).then(f) }
      return chain
    },
    select() {
      const p = Promise.resolve({ data: [], error: null })
      const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? p.then.bind(p) : k === 'maybeSingle' ? async () => ({ data: null }) : () => chain) })
      return chain
    },
    delete() {
      calls.push({ table, op: 'delete' })
      return { eq: async () => ({ error: null }) }
    },
  })
  return { from: vi.fn(from), calls }
}

const catalog = [{ id: 'c1', name: '鶏むね肉', unit: 'g' }]
const fridge = [{ id: 'i1', name: 'きゅうり', unit: '本' }]
const item = (line) => ({ rawText: line, ...resolveIngredient(parseIngredientLine(line), fridge, catalog) })

describe('取り込んだレシピの保存', () => {
  it('ない食材は在庫0で作り、取り込み元と元の行を保存する', async () => {
    const supabase = mockSupabase()
    const result = await saveRecipe({
      supabase, groupId: 'g1', userId: 'u1', title: 'バンバンジー', url: 'https://delishkitchen.tv/recipes/1',
      sourceKey: 'delishkitchen:1', sourceSite: 'DELISH KITCHEN', servings: 2, fridge,
      items: [item('鶏むね肉 1枚(250g)'), item('きゅうり 1本'), item('塩 少々'), item('水 100ml')],
    })
    expect(result).toEqual({ recipeId: 'r1' })
    const inserts = supabase.calls.filter((c) => c.op === 'insert')
    expect(inserts[0]).toMatchObject({ table: 'ingredients', row: { group_id: 'g1', name: '鶏むね肉', unit: 'g', quantity: 0, catalog_id: 'c1' } })
    expect(inserts.find((c) => c.table === 'recipes')).toMatchObject({ row: { source_key: 'delishkitchen:1', servings: 2, url: 'https://delishkitchen.tv/recipes/1' } })
    // 「塩 少々」も元の表記のまま保存する(数は空。在庫の数は推測しない)。水は保存しない
    expect(inserts.find((c) => c.table === 'recipe_ingredients').row).toEqual([
      { ingredient_id: 'new-1', required_quantity: 250, recipe_id: 'r1', raw_text: '鶏むね肉 1枚(250g)', amount_text: '1枚(250g)', note: null, source_name: null },
      { ingredient_id: 'i1', required_quantity: 1, recipe_id: 'r1', raw_text: 'きゅうり 1本', amount_text: '1本', note: null, source_name: null },
      { ingredient_id: expect.stringMatching(/^new-/), required_quantity: null, recipe_id: 'r1', raw_text: '塩 少々', amount_text: '少々', note: null, source_name: null },
    ])
  })

  it('同じレシピがすでにあれば重複と伝える', async () => {
    const supabase = mockSupabase({ recipeError: { code: '23505' } })
    const result = await saveRecipe({ supabase, groupId: 'g1', userId: 'u1', title: 'x', sourceKey: 'nadia:1/2', fridge, items: [item('きゅうり 1本')] })
    expect(result.error).toBe('このレシピはすでに保存されています')
  })

  it('材料の保存に失敗したらレシピも消す', async () => {
    const supabase = mockSupabase({ riError: { code: '42501' } })
    const result = await saveRecipe({ supabase, groupId: 'g1', userId: 'u1', title: 'x', fridge, items: [item('きゅうり 1本')] })
    expect(result.error).toBe('材料の保存に失敗しました')
    expect(supabase.calls.some((c) => c.table === 'recipes' && c.op === 'delete')).toBe(true)
  })

  it('保存する材料がなければ保存しない', async () => {
    const supabase = mockSupabase()
    const result = await saveRecipe({ supabase, groupId: 'g1', userId: 'u1', title: 'x', fridge, items: [item('水 100ml')] })
    expect(result.error).toMatch(/材料を1つ以上/)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('レシピのカスタマイズの保存', () => {
  it('新しい食材は在庫0で作り、材料をまとめて update_recipe に渡す', async () => {
    const supabase = mockSupabase()
    supabase.rpc = vi.fn().mockResolvedValue({ data: 'r1', error: null })
    const result = await updateRecipe({
      supabase, groupId: 'g1', recipeId: 'r1', title: 'わが家のバンバンジー', fridge,
      items: [
        { key: 'a', kind: 'existing', ingredient: fridge[0], name: 'きゅうり', unit: '本', requiredQuantity: '1', include: true },
        { key: 'b', kind: 'existing', ingredient: fridge[0], name: 'きゅうり', unit: '本', requiredQuantity: 0.5, include: true },
        item('鶏むね肉 1枚(250g)'),
        { key: 'c', kind: 'existing', ingredient: { id: 'x' }, name: '外す', unit: '個', requiredQuantity: 1, include: false },
      ],
      extras: { icon: '🥗', servings: 2, instructions: '和える', memo: null },
    })
    expect(result).toEqual({ recipeId: 'r1' })
    expect(supabase.calls.filter((c) => c.table === 'ingredients')).toHaveLength(1)
    expect(supabase.rpc).toHaveBeenCalledWith('update_recipe', {
      p_recipe_id: 'r1', p_title: 'わが家のバンバンジー', p_servings: 2, p_instructions: '和える', p_memo: null, p_icon: '🥗',
      p_items: [
        { ingredient_id: 'i1', required_quantity: 1.5, raw_text: null, amount_text: null, note: null, source_name: null },
        { ingredient_id: 'new-1', required_quantity: 250, raw_text: '鶏むね肉 1枚(250g)', amount_text: '1枚(250g)', note: null, source_name: null },
      ],
    })
  })

  it('材料がなければ DB を呼ばない', async () => {
    const supabase = mockSupabase()
    supabase.rpc = vi.fn()
    const result = await updateRecipe({ supabase, groupId: 'g1', recipeId: 'r1', title: 'x', fridge, items: [], extras: {} })
    expect(result.error).toMatch(/材料を1つ以上/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe('冷蔵庫とレシピの食材の整合性', () => {
  it('食材マスタにない材料は、カテゴリを推定して家庭の品目に登録し、冷蔵庫の行と結び付ける', async () => {
    const supabase = mockSupabase()
    const result = await saveRecipe({
      supabase, groupId: 'g1', userId: 'u1', title: '自家製', url: null, fridge: [],
      items: [{ key: 'a', kind: 'new', name: 'ほたて貝柱', unit: '個', requiredQuantity: 4, include: true }],
    })
    expect(result.recipeId).toBe('r1')
    const catalogInsert = supabase.calls.find((c) => c.table === 'ingredient_catalog')
    expect(catalogInsert.row).toMatchObject({ name: 'ほたて貝柱', unit: '個', category: '魚介類', group_id: 'g1' })
    const fridgeInsert = supabase.calls.find((c) => c.table === 'ingredients')
    expect(fridgeInsert.row).toMatchObject({ name: 'ほたて貝柱', catalog_id: catalogInsert.row ? expect.any(String) : undefined, quantity: 0 })
  })

  it('確認待ちの材料(どの食材か未確定)も保存できる(食材は空、元の名前と分量の表記を残す)', async () => {
    const supabase = mockSupabase()
    const result = await saveRecipe({
      supabase, groupId: 'g1', userId: 'u1', title: '麻婆豆腐', url: null, fridge,
      items: [{ key: 'a', kind: 'new', name: '豆腐', sourceName: '豆腐', unit: '丁', requiredQuantity: '', amountText: '1/2丁', include: true, needsChoice: true, rawText: '豆腐1/2丁' }],
    })
    expect(result.recipeId).toBe('r1')
    expect(supabase.calls.filter((c) => c.table === 'ingredients' || c.table === 'ingredient_catalog')).toHaveLength(0)
    expect(supabase.calls.find((c) => c.table === 'recipe_ingredients').row).toEqual([
      { ingredient_id: null, source_name: '豆腐', required_quantity: null, amount_text: '1/2丁', raw_text: '豆腐1/2丁', note: null, recipe_id: 'r1' },
    ])
  })

  it('「新しい食材」を選んだら、表記の似た冷蔵庫の食材に勝手にまとめない', async () => {
    const supabase = mockSupabase()
    await saveRecipe({
      supabase, groupId: 'g1', userId: 'u1', title: 'ポテト', url: null,
      fridge: [{ id: 'p1', name: 'じゃがいも', unit: '個' }],
      items: [{ key: 'a', kind: 'new', name: 'じゃが芋', unit: '個', requiredQuantity: 2, include: true, needsChoice: false }],
    })
    expect(supabase.calls.find((c) => c.table === 'ingredients').row).toMatchObject({ name: 'じゃが芋' })
  })

  it('付け替えた材料は、取り込んだときの表記をこの家の別名として覚える', async () => {
    const supabase = mockSupabase()
    await saveRecipe({
      supabase, groupId: 'g1', userId: 'u1', title: 'ポテサラ', url: null, fridge,
      items: [
        { key: 'a', kind: 'existing', ingredient: { id: 'p1', catalog_id: 'c-potato' }, name: 'じゃがいも', unit: '個', requiredQuantity: 2, include: true, learnAlias: { alias: 'メークイン', catalogId: 'c-potato' } },
      ],
    })
    expect(supabase.calls.find((c) => c.table === 'ingredient_aliases').row).toEqual({ group_id: 'g1', catalog_id: 'c-potato', alias: 'メークイン' })
  })
})

describe('手順ごとの材料の保存', () => {
  it('手順で使う材料を、保存先の食材(まとめた行も含む)に結び付けて保存する', async () => {
    const supabase = mockSupabase()
    await saveRecipe({
      supabase, groupId: 'g1', userId: 'u1', title: '肉じゃが', url: null, fridge,
      items: [
        { key: 'a', kind: 'existing', ingredient: fridge[0], name: 'きゅうり', unit: '本', requiredQuantity: 1, include: true },
        { key: 'b', kind: 'existing', ingredient: fridge[0], name: 'きゅうり', unit: '本', requiredQuantity: 1, include: true },
      ],
      steps: [{ id: 's1', text: '切る', uses: [{ itemKey: 'a', quantity: '1' }, { itemKey: 'b', quantity: '1' }] }],
    })
    const recipe = supabase.calls.find((c) => c.table === 'recipes').row
    expect(recipe.instructions).toBe('切る')
    expect(recipe.steps).toEqual([{ text: '切る', uses: [{ ingredient_id: 'i1', quantity: 1 }, { ingredient_id: 'i1', quantity: 1 }] }])
  })
})

