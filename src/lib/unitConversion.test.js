import { describe, expect, it } from 'vitest'
import { describeEstimate, exactFactor, indexCommonConversions, resolveConversion } from './unitConversion'
import { parseQuantity } from './quantity'

// migration 026 の初期データと同じ形の行(一部)
const rule = (catalog_id, from_unit, to_quantity, extra = {}) => ({
  catalog_id,
  from_unit,
  from_quantity: 1,
  to_unit: 'g',
  to_quantity,
  min_quantity: null,
  max_quantity: null,
  state_key: '一般',
  weight_basis: 'gross',
  usage_policy: 'suggest_only',
  source_id: 'AJI_FOOD',
  ...extra,
})
const common = indexCommonConversions([
  rule('c-nira', '束', 100),
  rule('c-komatsuna', '束', 300),
  rule('c-onion', '個', 200),
  rule('c-potato', '個', 150),
  rule('c-soy', '大さじ', 18, { weight_basis: 'volume_measure', usage_policy: 'conditional', source_id: 'AJI_COND' }),
  rule('c-soy', '小さじ', 6, { weight_basis: 'volume_measure', usage_policy: 'conditional', source_id: 'AJI_COND' }),
  rule('c-sugar', '大さじ', 9, { weight_basis: 'volume_measure', usage_policy: 'conditional', source_id: 'AJI_COND' }),
  rule('c-oil', '大さじ', 12, { weight_basis: 'volume_measure', usage_policy: 'conditional', source_id: 'EATREAT_OIL' }),
  rule('c-rice', '合', 150, { state_key: '精白米・生', weight_basis: 'volume_measure', usage_policy: 'conditional' }),
  rule('c-egg', '個', 61, { min_quantity: 58, max_quantity: 64, state_key: 'Mサイズ・殻付き', source_id: 'MAFF_EGG' }),
  rule('c-shimeji', 'パック', 100),
  rule('c-shrimp', '尾', 15, { min_quantity: 10, max_quantity: 20, state_key: '小・むき身' }),
  rule('c-shrimp', '尾', 40, { min_quantity: 30, max_quantity: 50, state_key: '大・殻つき' }),
])
const ing = (id, unit, catalog_id) => ({ id, unit, catalog_id })

describe('計量の定義による厳密な換算', () => {
  it('g⇔kg、ml⇔大さじ・小さじ・カップ・合', () => {
    expect(exactFactor('kg', 'g')).toBe(1000)
    expect(exactFactor('大さじ', 'ml')).toBe(15)
    expect(exactFactor('小さじ', '大さじ')).toBeCloseTo(1 / 3)
    expect(exactFactor('合', 'ml')).toBe(180)
    expect(exactFactor('大さじ', 'g')).toBeNull()
  })
  it('しょうゆを ml で数えている家では、大さじ1は 15ml(18g の目安は使わない)', () => {
    expect(resolveConversion({ quantity: 1, unit: '大さじ', ingredient: ing('soy', 'ml', 'c-soy'), common })).toEqual({ quantity: 15, kind: 'exact', confirmed: true })
  })
  it('1.5kg は 1500g', () => {
    expect(resolveConversion({ quantity: 1.5, unit: 'kg', ingredient: ing('pork', 'g', null), common })).toMatchObject({ quantity: 1500, kind: 'exact' })
  })
})

describe('共通の目安(候補だけ。確定しない)', () => {
  it('にら 1束 → 約100g、1/2束 → 約50g。確定扱いにしない', () => {
    const one = resolveConversion({ quantity: 1, unit: '束', ingredient: ing('nira', 'g', 'c-nira'), common })
    expect(one).toMatchObject({ quantity: 100, kind: 'common', confirmed: false })
    const half = resolveConversion({ quantity: parseQuantity('1/2'), unit: '束', ingredient: ing('nira', 'g', 'c-nira'), common })
    expect(half).toMatchObject({ quantity: 50, confirmed: false })
    expect(describeEstimate(half, 'g')).toBe('目安 約50g(1束 ≈ 100g・味の素パーク)')
  })
  it('同じ1束・1個でも食材ごとに違う', () => {
    expect(resolveConversion({ quantity: 1, unit: '束', ingredient: ing('k', 'g', 'c-komatsuna'), common }).quantity).toBe(300)
    expect(resolveConversion({ quantity: 1, unit: '個', ingredient: ing('o', 'g', 'c-onion'), common }).quantity).toBe(200)
    expect(resolveConversion({ quantity: 1, unit: '個', ingredient: ing('p', 'g', 'c-potato'), common }).quantity).toBe(150)
  })
  it('同じ大さじでも、しょうゆ18g・砂糖9g・油12g(g で数えている家)', () => {
    expect(resolveConversion({ quantity: 1, unit: '大さじ', ingredient: ing('s', 'g', 'c-soy'), common }).quantity).toBe(18)
    expect(resolveConversion({ quantity: 1, unit: '大さじ', ingredient: ing('s', 'g', 'c-sugar'), common }).quantity).toBe(9)
    expect(resolveConversion({ quantity: 1, unit: '大さじ', ingredient: ing('s', 'g', 'c-oil'), common }).quantity).toBe(12)
    // 大さじの目安しかない食材の小さじは、計量の定義(1/3)を通して出す
    expect(resolveConversion({ quantity: 1, unit: '小さじ', ingredient: ing('s', 'g', 'c-sugar'), common }).quantity).toBe(3)
  })
  it('米1合は生の精白米で約150g(炊いたご飯とは結び付けない)', () => {
    const r = resolveConversion({ quantity: 2, unit: '合', ingredient: ing('rice', 'g', 'c-rice'), common })
    expect(r).toMatchObject({ quantity: 300, confirmed: false })
    expect(r.rule.state_key).toBe('精白米・生')
  })
  it('卵は殻付きの重さの幅で出し、確定しない(個で数える家で 120g なら約2個)', () => {
    const g = resolveConversion({ quantity: 2, unit: '個', ingredient: ing('egg', 'g', 'c-egg'), common })
    expect(g).toMatchObject({ quantity: 122, range: [116, 128], confirmed: false })
    const count = resolveConversion({ quantity: 120, unit: 'g', ingredient: ing('egg', '個', 'c-egg'), common })
    expect(count.confirmed).toBe(false)
    expect(count.quantity).toBeCloseTo(1.967213, 5)
    expect(count.range).toEqual([1.875, 2.068966])
  })
  it('1パックは品目ごと。目安のない食材(豚こま)には、しめじの1パックを使わない', () => {
    expect(resolveConversion({ quantity: 1, unit: 'パック', ingredient: ing('s', 'g', 'c-shimeji'), common }).quantity).toBe(100)
    expect(resolveConversion({ quantity: 1, unit: 'パック', ingredient: ing('pork', 'g', 'c-pork'), common })).toBeNull()
  })
  it('状態(むき身・殻つき)で目安を選ぶ', () => {
    expect(resolveConversion({ quantity: 1, unit: '尾', ingredient: ing('e', 'g', 'c-shrimp'), common, state: 'むき身' }).quantity).toBe(15)
    expect(resolveConversion({ quantity: 1, unit: '尾', ingredient: ing('e', 'g', 'c-shrimp'), common, state: '殻つき' }).quantity).toBe(40)
  })
  it('家庭専用の品目(catalog_id なし)には共通の目安を使わない', () => {
    expect(resolveConversion({ quantity: 1, unit: '束', ingredient: ing('mine', 'g', null), common })).toBeNull()
  })
})

describe('家庭で確認した換算が優先', () => {
  it('家庭Aの「にら1束=80g」は家庭Aの食材にだけ効き、共通の100gより優先する', () => {
    const householdA = new Map([['nira-A:束', 80]])
    expect(resolveConversion({ quantity: 1, unit: '束', ingredient: ing('nira-A', 'g', 'c-nira'), household: householdA, common })).toMatchObject({
      quantity: 80,
      kind: 'household',
      confirmed: true,
    })
    // 家庭Bの食材(別の行)には効かない
    expect(resolveConversion({ quantity: 1, unit: '束', ingredient: ing('nira-B', 'g', 'c-nira'), household: householdA, common })).toMatchObject({
      quantity: 100,
      kind: 'common',
    })
  })
  it('1/3束を3回分は、端数なく1束分', () => {
    const third = resolveConversion({ quantity: parseQuantity('1/3'), unit: '束', ingredient: ing('n', 'g', 'c-nira'), household: new Map([['n:束', 90]]), common })
    expect(third.quantity).toBe(29.99997)
    expect(Math.round(third.quantity * 3)).toBe(90)
  })
})
