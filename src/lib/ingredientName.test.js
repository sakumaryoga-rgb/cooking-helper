import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMON_VARIANTS, analyzeName, buildNameIndex, matchIngredientName, nameKey } from './ingredientName'
import { applyChoice, resolveIngredient } from './recipeImport/match'
import { parseIngredientLine } from './recipeImport/ingredientLine'

// 本番と同じ食材マスタの初期データ(migration 002)を読み込んで照合する
const seed = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/002_ingredient_catalog.sql'), 'utf8')
const catalog = [...seed.matchAll(/\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+)\)/g)].map((m, i) => ({
  id: `c${i}`,
  name: m[1],
  unit: m[2],
  category: m[3],
  group_id: null,
}))
const byName = (name) => catalog.find((c) => c.name === name)

function resolveLine(line, { fridge = [], aliases = [] } = {}) {
  return resolveIngredient(parseIngredientLine(line), fridge, catalog, aliases)
}

describe('正規化の段階', () => {
  it('全角・半角、空白、かっこ、ひらがな・カタカナをそろえる', () => {
    expect(nameKey(' ジャガイモ（メークイン） ')).toBe('じゃがいも')
    expect(nameKey('ＢＡＣＯＮ')).toBe('bacon')
  })

  it('大きさ・表記上の修飾・状態の修飾を、本体の名前と分ける(元の表記は残す)', () => {
    expect(analyzeName('じゃがいも(中)')).toMatchObject({ base: 'じゃがいも', size: '中', state: [], original: 'じゃがいも(中)' })
    expect(analyzeName('じゃがいも中')).toMatchObject({ base: 'じゃがいも', size: '中' })
    expect(analyzeName('新じゃがいも')).toMatchObject({ base: 'じゃがいも', neutral: ['新'], state: [] })
    expect(analyzeName('冷凍えび')).toMatchObject({ base: 'えび', state: ['冷凍'] })
    expect(analyzeName('えび(冷凍)')).toMatchObject({ base: 'えび', annotState: ['冷凍'] })
    expect(analyzeName('じゃがいも', ['冷凍'])).toMatchObject({ annotState: ['冷凍'] })
    expect(analyzeName('干ししいたけ')).toMatchObject({ base: 'しいたけ', state: ['干し'] })
    // 名前の一部を修飾語と取り違えない
    expect(analyzeName('生姜').base).toBe('生姜')
    expect(analyzeName('中華麺').base).toBe('中華麺')
    expect(analyzeName('小松菜').base).toBe('小松菜')
  })

  it('共通の別名辞書の正式名は、すべて食材マスタにある', () => {
    for (const canonical of Object.keys(COMMON_VARIANTS)) expect(byName(canonical), canonical).toBeTruthy()
  })
})

describe('A: 自動で確定する(表記の違い)', () => {
  it.each([
    ['ジャガイモ 2個', 'じゃがいも', 2],
    ['じゃが芋 2個', 'じゃがいも', 2],
    ['馬鈴薯 2個', 'じゃがいも', 2],
    ['新じゃがいも 2個', 'じゃがいも', 2],
    ['じゃがいも(中) 2個', 'じゃがいも', 2],
    ['じゃがいも中 2個', 'じゃがいも', 2],
    ['玉葱 1個', '玉ねぎ', 1],
    ['たまねぎ 1個', '玉ねぎ', 1],
    ['タマネギ 1個', '玉ねぎ', 1],
    ['人参 1本', 'にんじん', 1],
    ['ニンジン 1本', 'にんじん', 1],
    ['生姜 1片', 'しょうが', 1],
    ['椎茸 4枚', 'しいたけ', null],
    ['鶏胸肉 300g', '鶏むね肉', 300],
    ['豚挽き肉 200g', '豚ひき肉', 200],
    ['合挽き肉 250g', '合いびき肉', 250],
    ['豚小間切れ肉 150g', '豚こま切れ肉', 150],
    ['鮭 2切れ', '鮭(切り身)', 2],
    ['海老 6尾', 'エビ', 6],
    ['玉子 3個', '卵', 3],
    ['絹ごし豆腐 1丁', '絹豆腐', 1],
    ['しょうゆ 大さじ2', '醤油', 30],
    ['みそ 大さじ1', '味噌', null],
    ['薄力粉 100g', '小麦粉', 100],
  ])('%s → %s', (line, name, quantity) => {
    const r = resolveLine(line)
    expect(r).toMatchObject({ kind: 'catalog', name, needsChoice: false })
    expect(r.catalogItem.id).toBe(byName(name).id)
    // 数量は食材の単位で書かれていれば保つ。単位が違えば換算せずに空にして入れてもらう
    if (quantity == null) expect(r).toMatchObject({ requiredQuantity: '', needsCheck: true })
    else expect(r.requiredQuantity).toBe(quantity)
  })

  it('冷蔵庫にある食材は、その行に結び付けて二重に作らない', () => {
    const fridge = [{ id: 'i-onion', name: '玉ねぎ', unit: '個', quantity: 3, catalog_id: byName('玉ねぎ').id }]
    expect(resolveLine('玉葱 1個', { fridge })).toMatchObject({ kind: 'existing', ingredient: { id: 'i-onion' }, requiredQuantity: 1 })
    expect(resolveLine('新たまねぎ 1個', { fridge })).toMatchObject({ kind: 'existing', ingredient: { id: 'i-onion' } })
  })
})

describe('別の食材を誤ってまとめない', () => {
  it.each([
    ['鶏もも肉 200g', '鶏もも肉'],
    ['鶏むね肉 200g', '鶏むね肉'],
    ['牛乳 200ml', '牛乳'],
    ['豆乳 200ml', '豆乳'],
    ['玉ねぎ 1個', '玉ねぎ'],
    ['長ねぎ 1本', '長ねぎ'],
    ['トマト 1個', 'トマト'],
    ['ミニトマト 6個', 'ミニトマト'],
    ['小麦粉 50g', '小麦粉'],
    ['片栗粉 大さじ1', '片栗粉'],
  ])('%s はそれ自身(%s)になる', (line, name) => {
    expect(resolveLine(line)).toMatchObject({ kind: 'catalog', name, needsChoice: false })
  })

  it('冷蔵庫に似た食材があっても、別の食材の行には結び付けない', () => {
    const fridge = [
      { id: 'i-momo', name: '鶏もも肉', unit: 'g', quantity: 300, catalog_id: byName('鶏もも肉').id },
      { id: 'i-milk', name: '牛乳', unit: 'ml', quantity: 1000, catalog_id: byName('牛乳').id },
      { id: 'i-tomato', name: 'トマト', unit: '個', quantity: 2, catalog_id: byName('トマト').id },
    ]
    expect(resolveLine('鶏むね肉 200g', { fridge })).toMatchObject({ kind: 'catalog', name: '鶏むね肉' })
    expect(resolveLine('豆乳 200ml', { fridge })).toMatchObject({ kind: 'catalog', name: '豆乳' })
    expect(resolveLine('ミニトマト 6個', { fridge })).toMatchObject({ kind: 'catalog', name: 'ミニトマト' })
  })

  it('生米と炊いたご飯はまとめない(ご飯は候補として確認する)', () => {
    expect(resolveLine('米 2合')).toMatchObject({ kind: 'catalog', name: '米' })
    const rice = resolveLine('ご飯 300g')
    expect(rice.kind === 'catalog' && rice.name === '米').toBe(false)
  })
})

describe('B: 候補から選んでもらう', () => {
  it('状態の修飾(冷凍・乾燥 など)が付いたものは、元の食材を候補に出す', () => {
    const r = resolveLine('冷凍えび 10尾')
    expect(r).toMatchObject({ needsChoice: true, choiceReason: 'state', sourceName: '冷凍えび' })
    expect(r.candidates[0]).toMatchObject({ kind: 'catalog', name: 'エビ' })
    expect(resolveLine('干ししいたけ 4枚').candidates[0]).toMatchObject({ name: 'しいたけ' })
  })

  it('部分一致は候補に出すだけで、自動で決めない', () => {
    const r = resolveLine('薄切りハーフベーコン 5枚')
    expect(r).toMatchObject({ needsChoice: true, choiceReason: 'similar', kind: 'new' })
    expect(r.candidates.map((c) => c.name)).toContain('ベーコン')
  })

  it('候補を選ぶと、その食材の単位で数量を計算し、取り込んだ表記を別名として覚える', () => {
    const r = resolveLine('冷凍えび 10尾')
    const chosen = applyChoice(r, r.candidates[0])
    expect(chosen).toMatchObject({ kind: 'catalog', name: 'エビ', requiredQuantity: 10, needsChoice: false })
    expect(chosen.learnAlias).toEqual({ alias: '冷凍えび', catalogId: byName('エビ').id })
  })

  it('新しい食材として登録することも選べる(元の表記で登録し、別名は覚えない)', () => {
    const r = resolveLine('冷凍えび 10尾')
    const asNew = applyChoice(r, { kind: 'new' })
    expect(asNew).toMatchObject({ kind: 'new', name: '冷凍えび', requiredQuantity: 10, needsChoice: false })
    expect(asNew.learnAlias).toBeUndefined()
  })
})

describe('C: 分類できない食材', () => {
  it('似た食材がなければ新しい食材にする(数量と単位はそのまま)', () => {
    expect(resolveLine('寒天 4g')).toMatchObject({ kind: 'new', name: '寒天', unit: 'g', requiredQuantity: 4, needsChoice: false, candidates: [] })
  })
})

describe('家庭ごとの別名の学習', () => {
  const potato = byName('じゃがいも')
  it('覚えた表記(メークイン)は、次から自動でその食材になる', () => {
    expect(resolveLine('メークイン 3個').kind).not.toBe('catalog')
    const aliases = [{ alias: 'メークイン', catalog_id: potato.id, group_id: 'g1' }]
    expect(resolveLine('メークイン 3個', { aliases })).toMatchObject({ kind: 'catalog', name: 'じゃがいも', requiredQuantity: 3, needsChoice: false })
  })

  it('家庭の別名は、共通の別名や辞書より優先する', () => {
    const aliases = [{ alias: '酒', catalog_id: byName('みりん').id, group_id: 'g1' }]
    expect(resolveLine('酒 大さじ1', { aliases })).toMatchObject({ name: 'みりん' })
    expect(resolveLine('酒 大さじ1')).toMatchObject({ name: '料理酒' })
  })

  it('照合は渡された別名だけを使う(ほかの家の別名は RLS で届かない)', () => {
    const index = buildNameIndex({ catalog, aliases: [] })
    expect(matchIngredientName('メークイン', index).status).not.toBe('auto')
  })
})
