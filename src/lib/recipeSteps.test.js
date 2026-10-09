import { describe, expect, it } from 'vitest'
import { savedUsageMismatches, stepsFromInstructions, stepsFromSaved, stepsToInstructions, stepsToSaved } from './recipeSteps'

const items = [
  { key: 'a', name: '玉ねぎ', ingredient: { id: 'i-onion' }, include: true, requiredQuantity: 1 },
  { key: 'b', name: '豆腐', sourceName: '豆腐', include: true, requiredQuantity: '' },
]

describe('手順の保存の形', () => {
  it('材料は食材 ID か確認待ちの名前で保存し、量のない材料は量を空にする', () => {
    const steps = [
      { id: 's1', text: ' 玉ねぎを切る ', uses: [{ itemKey: 'a', quantity: '1' }] },
      { id: 's2', text: '豆腐を入れる', uses: [{ itemKey: 'b', quantity: '' }] },
      { id: 's3', text: '', uses: [] },
    ]
    const targets = new Map([['a', { ingredient_id: 'i-onion' }], ['b', { source_name: '豆腐' }]])
    expect(stepsToSaved(steps, items, (item) => targets.get(item.key))).toEqual([
      { text: '玉ねぎを切る', uses: [{ ingredient_id: 'i-onion', quantity: 1 }] },
      { text: '豆腐を入れる', uses: [{ source_name: '豆腐', quantity: null }] },
    ])
    expect(stepsToInstructions(steps)).toBe('玉ねぎを切る\n豆腐を入れる')
  })

  it('保存した手順を編集の形に戻す。手順ごとの材料がない既存のレシピは作り方の文から作る', () => {
    const saved = [{ text: '切る', uses: [{ ingredient_id: 'i-onion', quantity: 1 }, { source_name: '豆腐', quantity: null }] }]
    const editable = stepsFromSaved(saved, '', items)
    expect(editable[0]).toMatchObject({ text: '切る', uses: [{ itemKey: 'a', quantity: 1 }, { itemKey: 'b', quantity: '' }] })
    expect(stepsFromSaved(null, '1. 切る\n2. 煮る', items).map((s) => s.text)).toEqual(['切る', '煮る'])
  })

  it('詳細画面: 手順の合計とレシピの分量の違いを集める', () => {
    const steps = [{ uses: [{ ingredient_id: 'i-onion', quantity: 1 }] }, { uses: [{ ingredient_id: 'i-onion', quantity: 1 }] }]
    expect(savedUsageMismatches(steps, [{ ingredient_id: 'i-onion', required_quantity: 1 }])).toEqual([{ ingredientId: 'i-onion', stepsTotal: 2, recipeQuantity: 1 }])
    expect(savedUsageMismatches(steps, [{ ingredient_id: 'i-onion', required_quantity: 2 }])).toEqual([])
  })
})
