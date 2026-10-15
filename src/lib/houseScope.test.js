import { describe, expect, it } from 'vitest'
import { eventInHouse, filterHouse, inHouse } from './houseScope'

describe('選んでいる家と共通の行だけを使う', () => {
  const rows = [
    { id: 'common', group_id: null },
    { id: 'mine', group_id: 'g1' },
    { id: 'other-house', group_id: 'g2' },
  ]
  it('共通の行と選んでいる家の行だけ', () => {
    expect(filterHouse(rows, 'g1').map((r) => r.id)).toEqual(['common', 'mine'])
    expect(filterHouse(rows, 'g2').map((r) => r.id)).toEqual(['common', 'other-house'])
  })
  it('家が決まっていなければ共通の行だけ', () => {
    expect(filterHouse(rows, null).map((r) => r.id)).toEqual(['common'])
    expect(inHouse(undefined, 'g1')).toBe(false)
  })
  it('リアルタイムの通知: ほかの家の行の変更は無視し、家の分からない削除の通知は読み直す', () => {
    expect(eventInHouse({ new: { id: 'x', group_id: 'g2' }, old: {} }, 'g1')).toBe(false)
    expect(eventInHouse({ new: { id: 'x', group_id: 'g1' } }, 'g1')).toBe(true)
    expect(eventInHouse({ new: { id: 'x', group_id: null } }, 'g1')).toBe(true)
    // 別の家から選んでいる家へ移した(更新前・更新後のどちらかが関係すれば読み直す)
    expect(eventInHouse({ new: { id: 'x', group_id: 'g1' }, old: { id: 'x', group_id: 'g2' } }, 'g1')).toBe(true)
    expect(eventInHouse({ new: {}, old: { id: 'x' } }, 'g1')).toBe(true)
  })
})
