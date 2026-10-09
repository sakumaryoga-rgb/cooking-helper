import { describe, expect, it } from 'vitest'
import { parseRecipeUrl, isAllowedFetchHost, SUPPORTED_SITES } from './sites'
import { extractRecipe } from './jsonld'
import { importIngredientLines } from './match'

// 実際のページで JSON-LD から料理名・材料・分量を読めることを確かめたサイト(docs/recipe-sites.md)
describe('対応しているレシピサイトの URL', () => {
  it.each([
    ['https://www.kurashiru.com/recipes/82b3201b-29f4-4db9-9fbb-82a1ce16d247', 'kurashiru:82b3201b-29f4-4db9-9fbb-82a1ce16d247'],
    ['https://delishkitchen.tv/recipes/194135459369058708', 'delishkitchen:194135459369058708'],
    ['https://oceans-nadia.com/user/10313/recipe/123456', 'nadia:10313/123456'],
    ['https://recipe.rakuten.co.jp/recipe/1290001623/', 'rakuten:1290001623'],
    ['https://www.kyounoryouri.jp/recipe/606711_%E9%B6%8F%E3%81%8C%E3%82%86.html', 'kyounoryouri:606711'],
    ['https://www.orangepage.net/recipes/304563', 'orangepage:304563'],
    ['https://www.lettuceclub.net/recipe/dish/37304/', 'lettuceclub:37304'],
    ['https://park.ajinomoto.co.jp/recipe/card/708666/', 'ajinomoto:708666'],
    ['https://www.kikkoman.co.jp/homecook/search/recipe/00054354/index.html', 'kikkoman:00054354'],
    ['https://erecipe.woman.excite.co.jp/detail/7786ae57fee788d4c99d15f32a471c01.html', 'erecipe:7786ae57fee788d4c99d15f32a471c01'],
    ['https://macaro-ni.jp/164739', 'macaroni:164739'],
  ])('%s', (url, sourceKey) => {
    const r = parseRecipeUrl(url)
    expect(r?.sourceKey).toBe(sourceKey)
    // 取り込み記録(recipe_import_runs)と取り込み元(recipes.source_key)の DB の制約に合う
    expect(r.site.id).toMatch(/^[a-z]{1,20}$/)
    expect(r.sourceKey).toMatch(/^[a-z]+:[0-9a-z/-]{1,80}$/)
  })

  it('対応していないサイト・レシピ以外のページ・http 以外は取り込まない(取得もしない)', () => {
    expect(parseRecipeUrl('https://cookpad.com/jp/recipes/26611206')).toBeNull()
    expect(parseRecipeUrl('https://www.sirogohan.com/recipe/kakuni/')).toBeNull()
    expect(parseRecipeUrl('https://recipe.rakuten.co.jp/category/30/')).toBeNull()
    expect(parseRecipeUrl('https://www.orangepage.net/author/3854')).toBeNull()
    expect(parseRecipeUrl('ftp://recipe.rakuten.co.jp/recipe/1290001623/')).toBeNull()
    expect(isAllowedFetchHost('169.254.169.254')).toBe(false)
    expect(isAllowedFetchHost('cookpad.com')).toBe(false)
    expect(isAllowedFetchHost('recipe.rakuten.co.jp')).toBe(true)
  })

  it('各サイトに画面の目印の色がある', () => {
    for (const s of SUPPORTED_SITES) expect(s.color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

// 各サイトの JSON-LD の書き方(合成データ。実際のページの形を模したもの)
const page = (recipe) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...recipe })}</script></html>`

describe('サイトごとの書き方を共通の処理で読む', () => {
  it('「…」で区切る材料・見出し(レタスクラブの形)', () => {
    const r = extractRecipe(page({ '@type': 'Recipe', name: 'たらのトマト煮', recipeYield: '２人分', recipeIngredient: ['生だら…2切れ(約200g)', '下味', '　・塩…小さじ1/4'] }))
    expect(r).toMatchObject({ title: 'たらのトマト煮', servings: 2 })
    const rows = importIngredientLines(r.ingredients)
    expect(rows.filter((x) => x.heading)).toHaveLength(1)
    expect(rows.filter((x) => x.item).map((x) => [x.item.sourceName, x.item.parsed.quantity, x.item.parsed.unit])).toEqual([
      ['生だら', 2, '切れ'],
      ['塩', 0.25, '小さじ'],
    ])
  })

  it('材料名の前のグループ記号「A」(味の素パークの形)', () => {
    const r = extractRecipe(page({ '@type': 'Recipe', name: '栗ごはん', recipeYield: '4(servings)', recipeIngredient: ['米 2合', 'Aみりん 大さじ1', 'A酒 大さじ1'] }))
    expect(r.servings).toBe(4)
    expect(importIngredientLines(r.ingredients).map((x) => x.item.sourceName)).toEqual(['米', 'みりん', '酒'])
  })

  it('先頭の「・」と、人数のない JSON-LD(NHK きょうの料理の形)', () => {
    const r = extractRecipe(page({ '@type': 'Recipe', name: '鶏がゆ', recipeIngredient: ['・鶏もも肉 1本', '・水 カップ7'] }))
    expect(r.servings).toBeNull()
    const rows = importIngredientLines(r.ingredients)
    expect(rows[0].item).toMatchObject({ sourceName: '鶏もも肉' })
    expect(rows[1].item.include).toBe(false)
  })

  it('g に似た文字(ɡ)の分量(オレンジページの形)', () => {
    const r = extractRecipe(page({ '@type': 'Recipe', name: 'アクアパッツァ', recipeYield: '2人分', recipeIngredient: ['あさり 200ɡ'] }))
    expect(importIngredientLines(r.ingredients)[0].item.parsed).toMatchObject({ quantity: 200, unit: 'g', grams: 200 })
  })

  it('@graph の中の Recipe(楽天レシピ・E・レシピなどの形)と、Recipe がない記事のページ', () => {
    const r = extractRecipe(page({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'Recipe', name: 'ハンバーグソース', recipeYield: '５', recipeIngredient: ['ケチャップ 大さじ5'] }] }))
    expect(r).toMatchObject({ title: 'ハンバーグソース', servings: 5, ingredients: ['ケチャップ 大さじ5'] })
    expect(extractRecipe(page({ '@type': 'Article', headline: '記事' }))).toBeNull()
  })
})
