import { describe, expect, it } from 'vitest'
import { buildCookPlan, convertAmount, describeExpiring, describeNotSubtracted, describeShortfalls, getRecipeStatus, scaleRecipe, sortRecipesByMakeability } from './matching'

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
      { ingredientId: 'potato', name: 'じゃがいも', unit: '個', requiredQuantity: 2, currentQuantity: 1, missingQuantity: 1, amountText: null },
      { ingredientId: 'carrot', name: 'にんじん', unit: '本', requiredQuantity: 1.5, currentQuantity: 0, missingQuantity: 1.5, amountText: null },
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

  describe('数で分からない分量・確認待ちの材料', () => {
    const fridge = stock([
      { id: 'pork', name: '豚こま切れ肉', unit: 'g', quantity: 300 },
      { id: 'salt', name: '塩', unit: 'g', quantity: 0, is_staple: true },
    ])
    const ri = (ingredient_id, required_quantity, amount_text, extra = {}) => ({ ingredient_id, required_quantity, amount_text, ingredient: { id: ingredient_id, name: ingredient_id, unit: 'g' }, ...extra })

    it('在庫があっても、数で分からない分量は「作れる」と断定しない(分量を確認)', () => {
      const status = getRecipeStatus({ recipe_ingredients: [ri('pork', null, '1パック')] }, fridge)
      expect(status).toMatchObject({ level: 'check', makeable: false, uncertainCount: 1, shortfallCount: 0 })
    })

    it('家庭で覚えた換算(1パック = 200g)があれば、数に直して判定する', () => {
      const conversions = new Map([['pork:パック', 200]])
      expect(getRecipeStatus({ recipe_ingredients: [ri('pork', null, '1パック')] }, fridge, { conversions })).toMatchObject({ level: 'makeable' })
      expect(getRecipeStatus({ recipe_ingredients: [ri('pork', null, '2パック')] }, fridge, { conversions })).toMatchObject({ level: 'almost' })
    })

    it('少々・適量は在庫(常備品を含む)があれば足りているとみなす', () => {
      expect(getRecipeStatus({ recipe_ingredients: [ri('salt', null, '少々')] }, fridge)).toMatchObject({ level: 'makeable' })
    })

    it('在庫がなければ、数が分からなくても不足にする(足りない量は書かない)', () => {
      const status = getRecipeStatus({ recipe_ingredients: [ri('beef', null, '1パック')] }, fridge)
      expect(status).toMatchObject({ level: 'almost', shortfalls: [{ missingQuantity: null, amountText: '1パック' }] })
      expect(describeShortfalls(status.shortfalls)).toBe('beef(在庫なし・1パック)')
    })

    it('確認待ちの材料(どの食材か未確定)があれば「作れる」と断定しない', () => {
      const status = getRecipeStatus({ recipe_ingredients: [ri('pork', 100, null), { ingredient_id: null, source_name: '豆腐', required_quantity: null, amount_text: '1/2丁' }] }, fridge)
      expect(status).toMatchObject({ level: 'check', pendingCount: 1 })
    })

    it('調理の確定画面では、数が分からない分量・確認待ちの材料を在庫から引かない(量を入れたときだけ)', () => {
      const status = getRecipeStatus({ recipe_ingredients: [ri('pork', null, '1パック'), { ingredient_id: null, source_name: '豆腐', amount_text: '1/2丁' }] }, fridge)
      const plan = buildCookPlan(status)
      expect(plan).toEqual([expect.objectContaining({ ingredientId: 'pork', quantity: '', include: false, unknown: true, amountText: '1パック' })])
    })
  })

  describe('家庭で覚えた換算の範囲', () => {
    const conversions = new Map([['pork:パック', 200]])
    it('同じ食材・同じ単位のときだけ使う(別の食材・別の単位・幅には使わない)', () => {
      expect(convertAmount('1パック', 'pork', conversions)).toEqual({ quantity: 200, per: 200, unit: 'パック' })
      expect(convertAmount('1パック', 'beef', conversions)).toBeNull()
      expect(convertAmount('1袋', 'pork', conversions)).toBeNull()
      expect(convertAmount('1〜2パック', 'pork', conversions)).toBeNull()
      expect(convertAmount('少々', 'pork', conversions)).toBeNull()
    })

    it('換算は冷蔵庫の食材の行ごとなので、ほかの家の同じ名前の食材には使わない', () => {
      // 家ごとに冷蔵庫の行(ID)が別。ほかの家の豚こま切れ肉(pork-other)には、この家の換算は当たらない
      expect(convertAmount('1パック', 'pork-other', conversions)).toBeNull()
    })

    it('人数を変えると、換算した量も人数に合わせる', () => {
      const recipe = { servings: 2, recipe_ingredients: [{ ingredient_id: 'pork', required_quantity: null, amount_text: '1パック' }] }
      const fridge = new Map([['pork', { id: 'pork', name: '豚こま切れ肉', unit: 'g', quantity: 300 }]])
      expect(getRecipeStatus(scaleRecipe(recipe, 1), fridge, { conversions }).lines[0].requiredQuantity).toBe(200)
      expect(getRecipeStatus(scaleRecipe(recipe, 2), fridge, { conversions })).toMatchObject({ level: 'almost', lines: [{ requiredQuantity: 400 }] })
    })

    it('調理の確定画面に、覚えた換算で計算したことを渡す(包装量が違えば直せる)', () => {
      const fridge = new Map([['pork', { id: 'pork', name: '豚こま切れ肉', unit: 'g', quantity: 300 }]])
      const status = getRecipeStatus({ recipe_ingredients: [{ ingredient_id: 'pork', required_quantity: null, amount_text: '1パック' }] }, fridge, { conversions })
      expect(buildCookPlan(status)).toEqual([expect.objectContaining({ quantity: 200, include: true, converted: { per: 200, unit: 'パック' }, amountText: '1パック' })])
    })

    it('在庫から引かない材料を、調理の確定画面に出すために集める', () => {
      const fridge = new Map([['pork', { id: 'pork', name: '豚こま切れ肉', unit: 'g', quantity: 300 }]])
      const status = getRecipeStatus({ recipe_ingredients: [{ ingredient_id: 'pork', required_quantity: null, amount_text: '1パック' }, { ingredient_id: null, source_name: '豆腐' }] }, fridge)
      const plan = buildCookPlan(status)
      expect(describeNotSubtracted(status, plan)).toEqual({ pending: ['豆腐'], unknown: ['豚こま切れ肉'] })
      expect(describeNotSubtracted(status, plan.map((r) => ({ ...r, include: true, quantity: 200 })))).toEqual({ pending: ['豆腐'], unknown: [] })
    })
  })
})

describe('分数の分量と常備品', () => {
  it('レシピの じゃがいも 1/2 は、在庫 0.5 で作れる', async () => {
    const { parseQuantity } = await import('./quantity')
    const recipe = { id: 'r', recipe_ingredients: [line('potato', parseQuantity('1/2'), 'じゃがいも')] }
    expect(getRecipeStatus(recipe, stock([{ id: 'potato', quantity: parseQuantity('0.5') }])).makeable).toBe(true)
    expect(getRecipeStatus(recipe, stock([{ id: 'potato', quantity: parseQuantity('½') }])).makeable).toBe(true)
  })

  it('1/3 を3つ分のレシピは、在庫 1 で作れる', async () => {
    const { parseQuantity } = await import('./quantity')
    const recipe = { id: 'r', recipe_ingredients: [line('cabbage', parseQuantity('1/3') * 3, 'キャベツ')] }
    expect(getRecipeStatus(recipe, stock([{ id: 'cabbage', quantity: 1 }])).makeable).toBe(true)
  })

  it('「作った」で常備品は最初から在庫から引かない', () => {
    const recipe = { id: 'r', recipe_ingredients: [line('salt', 2, '塩', 'g'), line('egg', 1, '卵')] }
    const status = getRecipeStatus(recipe, stock([{ id: 'salt', quantity: 0, is_staple: true }, { id: 'egg', quantity: 3 }]))
    const plan = buildCookPlan(status)
    expect(plan.find((r) => r.ingredientId === 'salt')).toMatchObject({ include: false, staple: true })
    expect(plan.find((r) => r.ingredientId === 'egg')).toMatchObject({ include: true })
  })
})

describe('期限が近い食材を使うレシピを優先', () => {
  const recipeA = { id: 'a', recipe_ingredients: [line('egg', 1, '卵')] }
  const recipeB = { id: 'b', recipe_ingredients: [line('carrot', 1, 'にんじん')] }
  const recipeC = { id: 'c', recipe_ingredients: [line('milk', 1, '牛乳'), line('salt', 1, '塩', 'g')] }
  const fridgeStock = stock([
    { id: 'egg', name: '卵', quantity: 6 },
    { id: 'carrot', name: 'にんじん', quantity: 2 },
    { id: 'milk', name: '牛乳', quantity: 1 },
    { id: 'salt', name: '塩', quantity: 0, is_staple: true },
  ])

  it('同じ「作れる」の中で、期限の近い食材を使うレシピが先に来る', () => {
    const expiryById = new Map([
      ['carrot', { daysLeft: 1, kind: 'estimated' }],
      ['milk', { daysLeft: 0, kind: 'use_by' }],
      ['egg', { daysLeft: 10, kind: 'best_before' }],
    ])
    const sorted = sortRecipesByMakeability([recipeA, recipeB, recipeC], fridgeStock, { expiryById })
    expect(sorted.map((s) => s.recipe.id)).toEqual(['c', 'b', 'a'])
    expect(sorted[0].status.expiring).toEqual([{ ingredientId: 'milk', name: '牛乳', daysLeft: 0, kind: 'use_by' }])
    expect(sorted[2].status.expiring).toEqual([])
    expect(describeExpiring(sorted[1].status.expiring)).toBe('にんじん(あと1日)')
  })

  it('作れないレシピは、期限が近くても作れるレシピより後', () => {
    const recipeShort = { id: 's', recipe_ingredients: [line('carrot', 5, 'にんじん')] }
    const sorted = sortRecipesByMakeability([recipeShort, recipeA], fridgeStock, { expiryById: new Map([['carrot', { daysLeft: 0, kind: 'estimated' }]]) })
    expect(sorted.map((s) => s.recipe.id)).toEqual(['a', 's'])
  })

  it('消費期限が切れた食材は勧めない(賞味期限切れは含める)', () => {
    const useBy = sortRecipesByMakeability([recipeC], fridgeStock, { expiryById: new Map([['milk', { daysLeft: -1, kind: 'use_by' }]]) })
    expect(useBy[0].status.expiring).toEqual([])
    const best = sortRecipesByMakeability([recipeC], fridgeStock, { expiryById: new Map([['milk', { daysLeft: -1, kind: 'best_before' }]]) })
    expect(describeExpiring(best[0].status.expiring)).toBe('牛乳(賞味期限切れ)')
  })
})
