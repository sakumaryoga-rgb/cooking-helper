import { describe, expect, it } from 'vitest'
import { describeShortfalls, getRecipeStatus, sortRecipesByMakeability } from './matching'

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
    expect(status).toMatchObject({ makeable: true, level: 'makeable', shortfallCount: 0, shortfalls: [] })
  })

  it('不足している材料を、必要量・在庫・あと何個かつきで返す', () => {
    const recipe = { id: 'r1', recipe_ingredients: [line('potato', 2, 'じゃがいも'), line('carrot', 1.5, 'にんじん', '本')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'potato', name: 'じゃがいも', unit: '個', quantity: 1 }]))
    expect(status).toMatchObject({ makeable: false, level: 'almost', shortfallCount: 2 })
    expect(status.shortfalls).toEqual([
      { ingredientId: 'potato', name: 'じゃがいも', unit: '個', requiredQuantity: 2, currentQuantity: 1, missingQuantity: 1 },
      { ingredientId: 'carrot', name: 'にんじん', unit: '本', requiredQuantity: 1.5, currentQuantity: 0, missingQuantity: 1.5 },
    ])
    expect(describeShortfalls(status.shortfalls)).toBe('じゃがいも あと1個、にんじん あと1.5本')
  })

  it('小数の誤差では不足にしない(在庫 0.1 + 0.2 で 0.3 必要)', () => {
    const status = getRecipeStatus({ id: 'r', recipe_ingredients: [line('a', 0.3)] }, stock([{ id: 'a', quantity: 0.1 + 0.2 }]))
    expect(status.makeable).toBe(true)
  })

  it('常備品は在庫が0でもあるとみなす', () => {
    const status = getRecipeStatus(
      { id: 'r', recipe_ingredients: [line('salt', 5, '塩', 'g'), line('egg', 1, '卵')] },
      stock([
        { id: 'salt', name: '塩', unit: 'g', quantity: 0, is_staple: true },
        { id: 'egg', name: '卵', unit: '個', quantity: 1 },
      ])
    )
    expect(status).toMatchObject({ makeable: true, stapleCount: 1 })
  })

  it('不足が3品以上は short、材料のないレシピは empty(作れる扱いにしない)', () => {
    const recipe = { id: 'r', recipe_ingredients: [line('a', 1), line('b', 1), line('c', 1)] }
    expect(getRecipeStatus(recipe, new Map()).level).toBe('short')
    expect(getRecipeStatus({ id: 'r', recipe_ingredients: [] }, new Map())).toMatchObject({ makeable: false, level: 'empty' })
    expect(getRecipeStatus({ id: 'r' }, new Map()).level).toBe('empty')
  })

  it('在庫にもレシピにも名前がない場合は(不明な食材)と表示する', () => {
    const status = getRecipeStatus({ id: 'r', recipe_ingredients: [{ ingredient_id: 'x', required_quantity: 1 }] }, new Map())
    expect(status.shortfalls[0].name).toBe('(不明な食材)')
  })

  it('不足の説明は先頭の品だけにして、残りの品数を添える', () => {
    const shortfalls = ['a', 'b', 'c', 'd'].map((n) => ({ name: n, unit: '個', missingQuantity: 1 }))
    expect(describeShortfalls(shortfalls, 2)).toBe('a あと1個、b あと1個、ほか2品')
  })
})

describe('sortRecipesByMakeability', () => {
  it('作れる → 不足の少ない順 → 材料未登録 の順に並べる', () => {
    const recipes = [
      { id: 'empty', recipe_ingredients: [] },
      { id: 'two-short', recipe_ingredients: [line('a', 1), line('b', 1)] },
      { id: 'makeable', recipe_ingredients: [line('c', 1)] },
      { id: 'one-short', recipe_ingredients: [line('a', 1), line('c', 1)] },
    ]
    const sorted = sortRecipesByMakeability(recipes, stock([{ id: 'c', name: 'c', unit: '個', quantity: 1 }]))
    expect(sorted.map((s) => s.recipe.id)).toEqual(['makeable', 'one-short', 'two-short', 'empty'])
  })
})

describe('代替食材', () => {
  const catalogById = new Map([
    ['c-cab', { id: 'c-cab', unit: '玉' }],
    ['c-nap', { id: 'c-nap', unit: '玉' }],
    ['c-thigh', { id: 'c-thigh', unit: 'g' }],
    ['c-breast', { id: 'c-breast', unit: 'g' }],
  ])
  const subs = [
    { id: 'r1', from_catalog_id: 'c-cab', to_catalog_id: 'c-nap', ratio: 0.6, note: null },
    { id: 'r2', from_catalog_id: 'c-thigh', to_catalog_id: 'c-breast', ratio: 1, note: null },
  ]
  const opts = { substitutions: subs, catalogById }

  it('足りない分を換算比率で代替し、「代替で作れる」にする(白菜はキャベツの0.6倍)', () => {
    const recipe = { id: 'r', recipe_ingredients: [line('cab', 1, 'キャベツ', '玉')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'cab', unit: '玉', quantity: 0, catalog_id: 'c-cab' }, { id: 'nap', name: '白菜', unit: '玉', quantity: 1, catalog_id: 'c-nap' }]), opts)
    expect(status.level).toBe('substitutable')
    expect(status.lines[0].substitutes).toEqual([{ ingredientId: 'nap', name: '白菜', unit: '玉', quantity: 0.6, ruleId: 'r1', note: null }])
  })

  it('方向がある: 逆向きのルールがなければ代替しない', () => {
    const recipe = { id: 'r', recipe_ingredients: [line('nap', 1, '白菜', '玉')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'nap', unit: '玉', quantity: 0, catalog_id: 'c-nap' }, { id: 'cab', unit: '玉', quantity: 5, catalog_id: 'c-cab' }]), opts)
    expect(status.level).toBe('almost')
  })

  it('同じ在庫を、そのもの用と代替用に重ねて割り当てない', () => {
    // むね肉 300g は、レシピのむね肉 200g にまず使う。もも肉 200g の代替には残り 100g しかないので補えない
    const recipe = { id: 'r', recipe_ingredients: [line('thigh', 200, 'もも', 'g'), line('breast', 200, 'むね', 'g')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'thigh', unit: 'g', quantity: 0, catalog_id: 'c-thigh' }, { id: 'breast', unit: 'g', quantity: 300, catalog_id: 'c-breast' }]), opts)
    expect(status.level).toBe('almost')
    expect(status.shortfalls).toEqual([expect.objectContaining({ ingredientId: 'thigh', missingQuantity: 200 })])
  })

  it('一部だけ足りない場合は、そのものの在庫と代替を組み合わせる', () => {
    const recipe = { id: 'r', recipe_ingredients: [line('thigh', 200, 'もも', 'g')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'thigh', unit: 'g', quantity: 120, catalog_id: 'c-thigh' }, { id: 'breast', name: 'むね', unit: 'g', quantity: 100, catalog_id: 'c-breast' }]), opts)
    expect(status.level).toBe('substitutable')
    expect(status.lines[0]).toMatchObject({ fromOriginal: 120, substitutes: [expect.objectContaining({ quantity: 80 })] })
  })

  it('冷蔵庫の行の単位が食材マスタと違う場合は代替しない', () => {
    const recipe = { id: 'r', recipe_ingredients: [line('thigh', 1, 'もも', '枚')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'thigh', unit: '枚', quantity: 0, catalog_id: 'c-thigh' }, { id: 'breast', unit: 'g', quantity: 500, catalog_id: 'c-breast' }]), opts)
    expect(status.level).toBe('almost')
  })

  it('「作った」の初期値: そのものは使える分、代替は換算した量', async () => {
    const { buildCookPlan } = await import('./matching')
    const recipe = { id: 'r', recipe_ingredients: [line('thigh', 200, 'もも', 'g'), line('egg', 2, '卵', '個')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'thigh', name: 'もも', unit: 'g', quantity: 120, catalog_id: 'c-thigh' }, { id: 'breast', name: 'むね', unit: 'g', quantity: 100, catalog_id: 'c-breast' }, { id: 'egg', name: '卵', unit: '個', quantity: 0 }]), opts)
    expect(buildCookPlan(status).map((r) => [r.ingredientId, r.quantity, r.substituteFor])).toEqual([
      ['thigh', 120, null],
      ['breast', 80, 'もも'],
      ['egg', 2, null],
    ])
  })
})
