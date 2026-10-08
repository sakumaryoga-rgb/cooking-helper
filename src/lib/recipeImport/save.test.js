import { describe, expect, it, vi } from 'vitest'
import { saveRecipe } from './save'
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
          : table === 'recipes'
            ? { data: recipeError ? null : { id: 'r1' }, error: recipeError }
            : { error: riError }
      const chain = { select: () => chain, single: async () => result, then: (f) => Promise.resolve(result).then(f) }
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
    expect(inserts[1]).toMatchObject({ table: 'recipes', row: { source_key: 'delishkitchen:1', servings: 2, url: 'https://delishkitchen.tv/recipes/1' } })
    expect(inserts[2].row).toEqual([
      { ingredient_id: 'new-1', required_quantity: 250, recipe_id: 'r1', raw_text: '鶏むね肉 1枚(250g)' },
      { ingredient_id: 'i1', required_quantity: 1, recipe_id: 'r1', raw_text: 'きゅうり 1本' },
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
    const result = await saveRecipe({ supabase, groupId: 'g1', userId: 'u1', title: 'x', fridge, items: [item('塩 少々')] })
    expect(result.error).toMatch(/材料を1つ以上/)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
