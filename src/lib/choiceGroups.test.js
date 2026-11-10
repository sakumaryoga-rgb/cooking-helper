import { describe, expect, it } from 'vitest'
import { addAlternative, dissolveSingletons } from './choiceGroups'

const it_ = (key, extra = {}) => ({ key, name: key, unit: 'g', requiredQuantity: 300, ...extra })

describe('「どれか1つ」の組の操作', () => {
  it('代わりの材料を足すと、元の材料と新しい番号の組になり、組の最後のすぐ後ろに入る(同じ単位なら同じ分量)', () => {
    const items = [it_('aibiki'), it_('onion', { unit: '個', requiredQuantity: 1 })]
    const next = addAlternative(items, 'aibiki', it_('gyu', { requiredQuantity: 1 }))
    expect(next.map((i) => [i.key, i.choiceGroup ?? null, i.requiredQuantity])).toEqual([
      ['aibiki', 1, 300],
      ['gyu', 1, 300],
      ['onion', null, 1],
    ])
    const third = addAlternative(next, 'gyu', it_('buta', { unit: '個', requiredQuantity: 1 }))
    expect(third.map((i) => i.key)).toEqual(['aibiki', 'gyu', 'buta', 'onion'])
    expect(third[2]).toMatchObject({ choiceGroup: 1, requiredQuantity: 1 })
  })

  it('別の材料の組は次の番号。任意の材料の代わりは任意', () => {
    const items = [it_('a', { choiceGroup: 1 }), it_('b', { choiceGroup: 1 }), it_('c', { optional: true })]
    const next = addAlternative(items, 'c', it_('d'))
    expect(next.find((i) => i.key === 'd')).toMatchObject({ choiceGroup: 2, optional: true })
  })

  it('候補が1つだけになった組は解除する', () => {
    const items = [it_('a', { choiceGroup: 1 }), it_('b', { choiceGroup: 1 }), it_('c', { choiceGroup: 2 })]
    expect(dissolveSingletons(items.filter((i) => i.key !== 'b')).map((i) => i.choiceGroup)).toEqual([null, null])
  })
})
