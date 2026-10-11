import { describe, expect, it, vi } from 'vitest'

vi.mock('@/supabaseClient', () => ({ supabase: {} }))

describe('レシピの読み込み', () => {
  it('材料の列(分量の表記・確認待ちの名前・状態)を読み込む', async () => {
    const { RECIPE_SELECT } = await import('./useRecipes')
    const columns = RECIPE_SELECT.match(/recipe_ingredients\(([^)]*\([^)]*\)[^)]*)\)/)[1]
    for (const c of ['id', 'ingredient_id', 'required_quantity', 'raw_text', 'amount_text', 'source_name', 'note']) {
      expect(columns.split(/,\s*/)).toContain(c)
    }
  })
})
