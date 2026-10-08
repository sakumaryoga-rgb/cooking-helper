import { describe, expect, it } from 'vitest'
import { parseRecipeUrl } from './sites'
import { extractRecipe, parseServings } from './jsonld'
import { isHeadingLine, parseIngredientLine } from './ingredientLine'
import { isNotStocked, mergeResolved, normalizeName, resolveIngredient } from './match'

const ld = (obj) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`

describe('レシピURL', () => {
  it.each([
    ['https://www.kurashiru.com/recipes/0001b364-1ba8-4169-944c-c793e926736a?utm=x#a', 'kurashiru:0001b364-1ba8-4169-944c-c793e926736a', 'https://www.kurashiru.com/recipes/0001b364-1ba8-4169-944c-c793e926736a'],
    ['https://delishkitchen.tv/recipes/194135459369058708/', 'delishkitchen:194135459369058708', 'https://delishkitchen.tv/recipes/194135459369058708'],
    ['https://oceans-nadia.com/user/254656/recipe/533736', 'nadia:254656/533736', 'https://oceans-nadia.com/user/254656/recipe/533736'],
  ])('%s', (input, key, url) => {
    expect(parseRecipeUrl(input)).toMatchObject({ sourceKey: key, url })
  })

  it.each(['https://cookpad.com/recipe/1', 'https://delishkitchen.tv/articles/1', 'javascript:alert(1)', 'not a url', 'https://evil.example/recipes/123456', ''])(
    '%s は対象外',
    (input) => expect(parseRecipeUrl(input)).toBeNull()
  )
})

describe('JSON-LD', () => {
  it('Recipe から料理名・人数・材料だけを取り出す(手順は取り出さない)', () => {
    const r = extractRecipe(
      ld({ '@context': 'https://schema.org', '@type': 'Recipe', name: '親子丼 &amp; みそ汁', recipeYield: '2人分', recipeIngredient: ['鶏もも肉 200g', '卵 3個'], recipeInstructions: [{ text: '手順1' }] })
    )
    expect(r).toEqual({ title: '親子丼 & みそ汁', servings: 2, yieldText: '2人分', ingredients: ['鶏もも肉 200g', '卵 3個'] })
    expect(JSON.stringify(r)).not.toContain('手順1')
  })

  it('@graph や配列、@type の配列にも対応する', () => {
    const html = ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Recipe', 'Thing'], name: 'カレー', recipeYield: ['4', '4 servings'], recipeIngredient: ['玉ねぎ 1個'] }] })
    expect(extractRecipe(html)).toMatchObject({ title: 'カレー', servings: 4, ingredients: ['玉ねぎ 1個'] })
    expect(extractRecipe(ld([{ '@type': 'Recipe', name: 'A', recipeIngredient: ['塩 少々'] }]))).toMatchObject({ title: 'A' })
  })

  it('Recipe がない・壊れた JSON は null', () => {
    expect(extractRecipe('<script type="application/ld+json">{oops</script>')).toBeNull()
    expect(extractRecipe(ld({ '@type': 'Article', name: 'x' }))).toBeNull()
    expect(parseServings('1 servings')).toBe(1)
    expect(parseServings('お好みで')).toBeNull()
  })
})

describe('材料の1行', () => {
  it.each([
    ['鶏むね肉 1枚(250g)', '鶏むね肉', 1, '枚', 250, null],
    ['長ねぎ[白い部分] 1/4本分', '長ねぎ[白い部分]', 0.25, '本', null, null],
    ['S&B 本鶏だし 1パック', 'S&B 本鶏だし', 1, 'パック', null, null],
    ['平打ちパスタ（乾麺） 40〜50g', '平打ちパスタ（乾麺）', 40, 'g', 40, null],
    ['しょうゆ 大さじ2', 'しょうゆ', 2, '大さじ', null, 30],
    ['塩 小さじ1と1/2', '塩', 1.5, '小さじ', null, 7.5],
    ['★砂糖 大さじ1', '砂糖', 1, '大さじ', null, 15],
    ['しょうが1かけ', 'しょうが', 1, 'かけ', null, null],
    ['水 450ml', '水', 450, 'ml', null, 450],
    ['卵　２個', '卵', 2, '個', null, null],
  ])('%s', (line, name, quantity, unit, grams, ml) => {
    expect(parseIngredientLine(line)).toMatchObject({ name, quantity, unit, grams, ml, vague: false })
  })

  it('適量・少々は分量なし', () => {
    expect(parseIngredientLine('塩こしょう 少々')).toMatchObject({ name: '塩こしょう', quantity: null, vague: true })
    expect(parseIngredientLine('サラダ油 適量')).toMatchObject({ vague: true })
  })

  it('見出しの行を見分ける', () => {
    expect(isHeadingLine('＜タレ＞')).toBe(true)
    expect(isHeadingLine('【A】')).toBe(true)
    expect(isHeadingLine('鶏もも肉 200g')).toBe(false)
  })
})

describe('食材との突き合わせ', () => {
  const fridge = [{ id: 'i1', name: 'ニンジン', unit: '本' }]
  const catalog = [
    { id: 'c1', name: '鶏むね肉', unit: 'g' },
    { id: 'c2', name: 'ベーコン', unit: 'g' },
    { id: 'c3', name: '酒', unit: 'ml' },
    { id: 'c4', name: '砂糖', unit: 'g' },
  ]
  const resolve = (line) => resolveIngredient(parseIngredientLine(line), fridge, catalog)

  it('冷蔵庫の食材を優先し、カタカナとひらがなの違いは同じとみなす', () => {
    expect(resolve('にんじん 1本')).toMatchObject({ kind: 'existing', ingredient: fridge[0], requiredQuantity: 1, include: true, needsCheck: false })
  })

  it('食材マスタの単位に直す(かっこ内の g、大さじの ml)', () => {
    expect(resolve('鶏むね肉 1枚(250g)')).toMatchObject({ kind: 'catalog', requiredQuantity: 250, unit: 'g', needsCheck: false })
    expect(resolve('酒 大さじ2')).toMatchObject({ kind: 'catalog', requiredQuantity: 30, unit: 'ml' })
  })

  it('単位を直せないもの、名前の一部だけが一致したものは確認を求める', () => {
    expect(resolve('砂糖 大さじ1')).toMatchObject({ kind: 'catalog', requiredQuantity: 1, needsCheck: true })
    expect(resolve('薄切りハーフベーコン 5枚')).toMatchObject({ kind: 'catalog', name: 'ベーコン', needsCheck: true })
  })

  it('知らない食材は新しい食材にし、かっこ書きを外す', () => {
    expect(resolve('サラダチキン（プレーン） 50g')).toMatchObject({ kind: 'new', name: 'サラダチキン', unit: 'g', requiredQuantity: 50 })
  })

  it('水・お湯・ゆで汁と、適量・少々は最初は保存しない', () => {
    expect(resolve('水 450ml').include).toBe(false)
    expect(resolve('鶏のゆで汁 大さじ2').include).toBe(false)
    expect(resolve('塩 少々')).toMatchObject({ include: false, requiredQuantity: '' })
    expect(isNotStocked('お湯')).toBe(true)
    expect(isNotStocked('水菜')).toBe(false)
  })

  it('同じ食材の行は必要量を足してまとめる', () => {
    const rows = mergeResolved([resolve('長ねぎ[青い部分] 1本分'), resolve('長ねぎ[白い部分] 1/4本分'), resolve('塩 少々')])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: '長ねぎ', requiredQuantity: 1.25 })
    expect(normalizeName('長ねぎ[白い部分]')).toBe('長ねぎ')
  })
})
