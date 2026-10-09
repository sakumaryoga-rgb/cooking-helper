import { describe, expect, it } from 'vitest'
import { categoryLook, dishLook, greeting } from './foodLook'

describe('見た目の対応表', () => {
  it('カテゴリと料理名から絵文字を選ぶ', () => {
    expect(categoryLook('肉類').emoji).toBe('🍖')
    expect(categoryLook('葉茎菜類').emoji).toBe('🥬')
    expect(categoryLook(undefined).emoji).toBe('🥫')
    expect(categoryLook('卵・乳製品', '牛乳').emoji).toBe('🥛')
    expect(dishLook({ id: 'r1', title: 'ポークカレー' }).emoji).toBe('🍛')
    expect(dishLook({ id: 'r2', title: 'だし巻き卵' }).emoji).toBe('🍳')
    expect(dishLook({ id: 'r4', title: 'オムライス' }).emoji).toBe('🍳')
    expect(dishLook({ id: 'r3', title: 'なにか' }).emoji).toBe('🍽️')
    expect(dishLook({ id: 'r1', title: 'x' }).bg).toBe(dishLook({ id: 'r1', title: 'y' }).bg)
  })
  it('時間帯であいさつが変わる', () => {
    expect(greeting(new Date(2026, 0, 1, 8)).text).toBe('おはようございます')
    expect(greeting(new Date(2026, 0, 1, 20)).sub).toMatch(/晩ごはん/)
  })
})
