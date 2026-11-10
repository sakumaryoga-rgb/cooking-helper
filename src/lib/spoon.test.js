import { describe, expect, it } from 'vitest'
import { spoonPatch, spoonReference, unspoonPatch, withSpoon } from './spoon'

const soyMl = { key: 'k1', kind: 'existing', ingredient: { id: 'i1', name: 'しょうゆ', unit: 'ml', catalog_id: 'c-soy' }, name: 'しょうゆ', unit: 'ml', include: true }
const sugarG = { key: 'k2', kind: 'existing', ingredient: { id: 'i2', name: '砂糖', unit: 'g', catalog_id: 'c-sugar' }, name: '砂糖', unit: 'g', include: true }
const catalogById = new Map([
  ['c-soy', { id: 'c-soy', name: 'しょうゆ', category: '調味料・油' }],
  ['c-sugar', { id: 'c-sugar', name: '砂糖', category: '調味料・油' }],
  ['c-onion', { id: 'c-onion', name: '玉ねぎ', category: '根菜類' }],
])

describe('大さじ・小さじの入力', () => {
  it('ml の食材は数に直して持ち、表記「大さじ2」を残す', () => {
    expect(spoonPatch(soyMl, '大さじ', '2')).toEqual({ spoon: '大さじ', spoonCount: '2', amountText: '大さじ2', requiredQuantity: '30', needsCheck: false })
    expect(spoonReference({ ...soyMl, spoon: '大さじ', spoonCount: '2' })).toBe('= 30ml')
  })

  it('g の食材は数を決めず(表記だけ)、ml と、目安があれば g を参考に出す', () => {
    expect(spoonPatch(sugarG, '小さじ', '1').requiredQuantity).toBe('')
    const common = new Map([['c-sugar', [{ from_quantity: 1, from_unit: '大さじ', to_quantity: 9, to_unit: 'g', source_id: 'AJI_COND', fit: 'general' }]]])
    const ref = spoonReference({ ...sugarG, spoon: '大さじ', spoonCount: '2' }, common)
    expect(ref).toMatch(/^= 30ml/)
    expect(spoonReference({ ...sugarG, spoon: '大さじ', spoonCount: '2' }, null)).toBe('= 30ml')
  })

  it('食材の単位に戻すと、直せる量は同じ量の数にする', () => {
    expect(unspoonPatch({ ...soyMl, spoon: '小さじ', spoonCount: '1' })).toMatchObject({ spoon: null, amountText: '', requiredQuantity: '5' })
  })

  it('取り込んだ調味料の「大さじ1と1/2」を大さじの入力にする。幅のある量・調味料以外はそのまま', () => {
    expect(withSpoon({ ...soyMl, amountText: '大さじ1と1/2', requiredQuantity: '' }, catalogById)).toMatchObject({ spoon: '大さじ', spoonCount: '1.5', requiredQuantity: '22.5' })
    const range = { ...soyMl, amountText: '大さじ1〜2' }
    expect(withSpoon(range, catalogById)).toBe(range)
    const onion = { key: 'k3', kind: 'existing', ingredient: { id: 'i3', name: '玉ねぎ', unit: '個', catalog_id: 'c-onion' }, name: '玉ねぎ', unit: '個', amountText: '大さじ1' }
    expect(withSpoon(onion, catalogById)).toBe(onion)
  })
})
