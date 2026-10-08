import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatExpiryLabel, getExpiryInfo } from './shelfLife'

describe('getExpiryInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const catalog = new Map([['meat', { id: 'meat', shelf_life_days: 3 }]])

  it('日付のあるロットのうち最も古い追加日から期限を計算する', () => {
    const info = getExpiryInfo(
      { id: 'i', catalog_id: 'meat' },
      [
        { added_on: '2026-10-07', quantity: 100 },
        { added_on: '2026-10-06', quantity: 50 },
      ],
      catalog
    )
    expect(info.daysLeft).toBe(1)
  })

  it('日付のないロットと数量0のロットは無視する', () => {
    const info = getExpiryInfo(
      { id: 'i', catalog_id: 'meat' },
      [
        { added_on: null, quantity: 100 },
        { added_on: '2026-10-01', quantity: 0 },
        { added_on: '2026-10-08', quantity: 1 },
      ],
      catalog
    )
    expect(info.daysLeft).toBe(3)
  })

  it('日付のあるロットがなければ null(期限不明)', () => {
    expect(getExpiryInfo({ id: 'i', catalog_id: 'meat' }, [{ added_on: null, quantity: 1 }], catalog)).toBeNull()
    expect(getExpiryInfo({ id: 'i', catalog_id: 'meat' }, undefined, catalog)).toBeNull()
  })

  it('マスタに日持ちがなければ7日で計算する', () => {
    const info = getExpiryInfo({ id: 'i', catalog_id: 'unknown' }, [{ added_on: '2026-10-08', quantity: 1 }], catalog)
    expect(info.daysLeft).toBe(7)
  })
})

describe('formatExpiryLabel', () => {
  it.each([
    [-1, '期限切れ'],
    [0, '本日まで'],
    [3, 'あと3日'],
  ])('%i日 → %s', (days, label) => {
    expect(formatExpiryLabel(days)).toBe(label)
  })
})
