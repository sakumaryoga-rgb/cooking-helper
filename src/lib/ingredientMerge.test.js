import { describe, expect, it } from 'vitest'
import { similarPairs } from './ingredientMerge'

describe('表記揺れの候補', () => {
  it('片方の名前がもう片方を含む組を出し、在庫がない方をまとめる側にする', () => {
    const pairs = similarPairs([
      { id: 'a', name: '豚バラ肉', unit: 'g', quantity: 300 },
      { id: 'b', name: '豚バラ', unit: 'g', quantity: 0 },
      { id: 'c', name: 'キャベツ', unit: '玉', quantity: 1 },
    ])
    expect(pairs.map((p) => [p.drop.id, p.keep.id])).toEqual([['b', 'a']])
  })

  it('単位が違って両方に在庫がある組は出さない', () => {
    expect(similarPairs([{ id: 'a', name: '卵', unit: '個', quantity: 6 }, { id: 'b', name: '卵パック', unit: 'パック', quantity: 1 }])).toEqual([])
  })
})
