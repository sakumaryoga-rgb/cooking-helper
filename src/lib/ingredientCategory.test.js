import { describe, expect, it } from 'vitest'
import { guessCategory } from './ingredientCategory'

describe('カテゴリの推定', () => {
  it.each([
    ['豚バラ肉', '肉類'],
    ['ほたて貝柱', '魚介類'],
    ['じゃが芋', '根菜類'],
    ['ミニトマト', '果菜類'],
    ['小松菜', '葉茎菜類'],
    ['生クリーム', '卵・乳製品'],
    ['厚揚げ', '大豆製品'],
    ['エリンギ', 'キノコ類'],
    ['めんつゆ', '調味料・油'],
    ['ゆでうどん', '麺・パン'],
    ['寒天', 'その他'],
  ])('%s → %s', (name, category) => {
    expect(guessCategory(name)).toBe(category)
  })
})
