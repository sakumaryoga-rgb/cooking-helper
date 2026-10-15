import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryInfo, categoryOf, classifyRecipe } from './recipeCategory'

describe('料理カテゴリの自動分類', () => {
  it.each([
    ['肉じゃが', ['牛こま切れ肉', 'じゃがいも', 'みりん'], 'japanese'],
    ['基本の豚汁', ['豚バラ肉', '大根', '味噌'], 'japanese'],
    ['麻婆豆腐', ['豆腐', '豚ひき肉', '豆板醤'], 'chinese'],
    ['カルボナーラ', ['スパゲッティ', '卵', 'パルメザンチーズ'], 'italian'],
    ['煮込みハンバーグ', ['合いびき肉', '玉ねぎ', 'デミグラスソース'], 'western'],
    ['豚キムチ', ['豚バラ肉', 'キムチ'], 'korean'],
    ['ガパオライス', ['鶏ひき肉', 'ナンプラー', 'バジル'], 'ethnic'],
  ])('料理名に明らかな手がかりがあれば分類する: %s', (title, ingredientNames, expected) => {
    expect(classifyRecipe({ title, ingredientNames })).toBe(expected)
  })

  it('サイトの構造化データ(recipeCuisine)を手がかりにする', () => {
    expect(classifyRecipe({ title: '鶏肉のうま煮', cuisine: ['中華'] })).toBe('chinese')
    expect(classifyRecipe({ title: 'ごちそうサラダ', keywords: ['韓国料理'] })).toBe('korean')
  })

  it('判定が曖昧なものは「その他・未分類」にする', () => {
    expect(classifyRecipe({ title: '主人が絶賛のナス・ピーマン', ingredientNames: ['ナス', 'ピーマン'] })).toBe('other')
    expect(classifyRecipe({ title: '' })).toBe('other')
    // ジャンルの違う手がかりが同じくらい(マカロニ = イタリアン、グラタン = 洋食)
    expect(classifyRecipe({ title: 'マカロニグラタン' })).toBe('other')
    // 材料だけの弱い手がかりが1つ
    expect(classifyRecipe({ title: '野菜炒め', ingredientNames: ['キャベツ', 'オイスターソース'] })).toBe('other')
  })

  it('材料の手がかりが重なれば、料理名に手がかりがなくても分類する', () => {
    expect(classifyRecipe({ title: 'わが家の炒め物', ingredientNames: ['豆板醤', '甜麺醤', '鶏ガラスープの素'] })).toBe('chinese')
  })

  it('レシピサイトの名前(ドメイン)では決めない', () => {
    expect(classifyRecipe({ title: 'とりあえずの一品', keywords: ['DELISH KITCHEN'] })).toBe('other')
  })
})

describe('表示するカテゴリ', () => {
  it('利用者が選んだカテゴリを優先し、自動の分類で変えない', () => {
    expect(categoryOf({ title: '麻婆豆腐', category: 'japanese', category_manual: true })).toBe('japanese')
  })

  it('保存した自動の分類があればそれを使い、なければ料理名と材料から分類する(既存のレシピ)', () => {
    expect(categoryOf({ title: '何かの料理', category: 'western', category_manual: false })).toBe('western')
    expect(categoryOf({ title: '親子丼', category: null, recipe_ingredients: [{ ingredient: { name: '鶏もも肉' } }] })).toBe('japanese')
    expect(categoryOf({ title: 'ふしぎな料理', category: null })).toBe('other')
  })

  it('知らないカテゴリ(新しいアプリで増えたもの)は、その他として扱う', () => {
    expect(categoryOf({ title: '麻婆豆腐', category: 'spanish', category_manual: true })).toBe('other')
    expect(categoryInfo('spanish').id).toBe('other')
  })

  it('カテゴリは「その他・未分類」を含む7つ', () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual(['和食', '中華', 'イタリアン', '洋食', '韓国料理', 'エスニック', 'その他・未分類'])
  })
})
