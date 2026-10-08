import { describe, expect, it } from 'vitest'
import { getRecipeStatus, sortRecipesByMakeability } from './matching'

const stock = (items) => new Map(items.map((i) => [i.id, i]))
const line = (ingredient_id, required_quantity, name = ingredient_id, unit = '個') => ({
  ingredient_id,
  required_quantity,
  ingredient: { id: ingredient_id, name, unit },
})

describe('getRecipeStatus', () => {
  it('必要量がすべて在庫以上なら作れる', () => {
    const recipe = { id: 'r1', recipe_ingredients: [line('chicken', 200, '鶏もも肉', 'g'), line('egg', 2, '卵')] }
    const status = getRecipeStatus(
      recipe,
      stock([
        { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 300 },
        { id: 'egg', name: '卵', unit: '個', quantity: 2 },
      ])
    )
    expect(status).toEqual({ makeable: true, shortfallCount: 0, shortfalls: [] })
  })

  it('不足している材料を必要量と現在量つきで返す', () => {
    const recipe = { id: 'r1', recipe_ingredients: [line('potato', 2, 'じゃがいも'), line('carrot', 1, 'にんじん', '本')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'potato', name: 'じゃがいも', unit: '個', quantity: 1 }]))
    expect(status.makeable).toBe(false)
    expect(status.shortfallCount).toBe(2)
    expect(status.shortfalls).toEqual([
      { ingredientId: 'potato', name: 'じゃがいも', unit: '個', requiredQuantity: 2, currentQuantity: 1 },
      { ingredientId: 'carrot', name: 'にんじん', unit: '本', requiredQuantity: 1, currentQuantity: 0 },
    ])
  })

  it('材料のないレシピは作れる扱いになる', () => {
    expect(getRecipeStatus({ id: 'r', recipe_ingredients: [] }, new Map()).makeable).toBe(true)
    expect(getRecipeStatus({ id: 'r' }, new Map()).makeable).toBe(true)
  })

  it('在庫にもレシピにも名前がない場合は(不明な食材)と表示する', () => {
    const status = getRecipeStatus({ id: 'r', recipe_ingredients: [{ ingredient_id: 'x', required_quantity: 1 }] }, new Map())
    expect(status.shortfalls[0].name).toBe('(不明な食材)')
  })
})

describe('sortRecipesByMakeability', () => {
  it('作れるレシピを先頭に、残りを不足品目の少ない順に並べる', () => {
    const recipes = [
      { id: 'two-short', recipe_ingredients: [line('a', 1), line('b', 1)] },
      { id: 'makeable', recipe_ingredients: [line('c', 1)] },
      { id: 'one-short', recipe_ingredients: [line('a', 1), line('c', 1)] },
    ]
    const sorted = sortRecipesByMakeability(recipes, stock([{ id: 'c', name: 'c', unit: '個', quantity: 1 }]))
    expect(sorted.map((s) => s.recipe.id)).toEqual(['makeable', 'one-short', 'two-short'])
  })
})
