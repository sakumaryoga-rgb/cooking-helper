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

describe('ロットの期限(入力した期限と推定)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
  })
  afterEach(() => vi.useRealTimers())

  const catalog = new Map([['meat', { id: 'meat', shelf_life_days: 3 }]])
  const ing = { id: 'i', catalog_id: 'meat' }

  it('入力した期限を推定より優先し、種類を区別する', async () => {
    const { getBatchExpiry, describeExpiry } = await import('./shelfLife')
    expect(getBatchExpiry({ added_on: '2026-10-01', use_by: '2026-10-10' }, ing, catalog)).toMatchObject({ kind: 'use_by', daysLeft: 2, estimated: false })
    expect(getBatchExpiry({ added_on: '2026-10-01', best_before: '2026-10-20' }, ing, catalog)).toMatchObject({ kind: 'best_before', daysLeft: 12 })
    const est = getBatchExpiry({ added_on: '2026-10-07' }, ing, catalog)
    expect(est).toMatchObject({ kind: 'estimated', daysLeft: 2, estimated: true })
    expect(describeExpiry(est)).toBe('推定 10/10・あと2日')
    expect(getBatchExpiry({ added_on: null }, ing, catalog)).toBeNull()
  })

  it('食材の期限は在庫のあるロットのうち最も早いもの。期限切れ・間近・未設定を区別する', async () => {
    const { getExpiryState } = await import('./shelfLife')
    const info = getExpiryInfo(ing, [
      { added_on: '2026-10-08', best_before: '2026-10-30', quantity: 1 },
      { added_on: '2026-10-08', use_by: '2026-10-07', quantity: 1 },
      { added_on: '2026-10-08', use_by: '2026-10-01', quantity: 0 },
    ], catalog)
    expect(info).toMatchObject({ kind: 'use_by', daysLeft: -1 })
    expect(getExpiryState(info)).toBe('expired')
    expect(getExpiryState({ daysLeft: 2 })).toBe('soon')
    expect(getExpiryState({ daysLeft: 3 })).toBe('ok')
    expect(getExpiryState(null)).toBe('none')
  })
})

describe('使える在庫(消費期限切れのロットを除く)', () => {
  it('消費期限切れのロットだけを除き、賞味期限切れ・期限なしは含める', async () => {
    const { usableQuantity, usableIngredientsById } = await import('./shelfLife')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T12:00:00'))
    const milk = { id: 'milk', name: '牛乳', unit: 'ml', quantity: 1000 }
    const lots = [
      { ingredient_id: 'milk', quantity: 400, use_by: '2026-10-09' },
      { ingredient_id: 'milk', quantity: 300, best_before: '2026-10-09' },
      { ingredient_id: 'milk', quantity: 300, added_on: null },
    ]
    expect(usableQuantity(milk, lots, new Map())).toBe(600)
    const byId = usableIngredientsById([milk, { id: 'egg', quantity: 2 }], lots, new Map())
    expect(byId.get('milk').quantity).toBe(600)
    expect(byId.get('egg').quantity).toBe(2)
    expect(milk.quantity).toBe(1000)
    vi.useRealTimers()
  })
})
