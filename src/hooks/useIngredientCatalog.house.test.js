import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useIngredientCatalogSource } from './useIngredientCatalog'

const order = vi.fn()
let onChange = null
let onStatus = null
vi.mock('@/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ order }) }),
    channel: () => {
      const ch = {
        on: (_t, _o, cb) => {
          onChange = cb
          return ch
        },
        subscribe: (cb) => {
          onStatus = cb
          return ch
        },
      }
      return ch
    },
    removeChannel: vi.fn(),
  },
}))

const rows = [
  { id: 'common', name: '卵', group_id: null },
  { id: 'mine', name: '花椒', group_id: 'g1' },
  { id: 'other', name: '実家の香辛料', group_id: 'g2' },
]

describe('食材マスタ(家ごと)', () => {
  it('共通の品目と選んでいる家の品目だけを使う(所属している別の家の品目は混ぜない)', async () => {
    order.mockResolvedValue({ data: rows, error: null })
    const { result } = renderHook(() => useIngredientCatalogSource('g1'))
    await waitFor(() => expect(result.current.catalog.map((c) => c.id)).toEqual(['common', 'mine']))
  })

  it('ほかの家の品目の通知では読み直さず、選んでいる家の通知・つなぎ直しでは読み直す', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    order.mockClear()
    order.mockResolvedValue({ data: rows, error: null })
    renderHook(() => useIngredientCatalogSource('g1'))
    await waitFor(() => expect(order).toHaveBeenCalledTimes(1))
    act(() => {
      onStatus('SUBSCRIBED')
      onChange({ eventType: 'INSERT', new: { id: 'x', group_id: 'g2' }, old: {} })
      vi.advanceTimersByTime(300)
    })
    expect(order).toHaveBeenCalledTimes(1)
    act(() => {
      onChange({ eventType: 'INSERT', new: { id: 'y', group_id: 'g1' }, old: {} })
      vi.advanceTimersByTime(300)
    })
    await waitFor(() => expect(order).toHaveBeenCalledTimes(2))
    // 通信が切れてつなぎ直した(取りこぼした通知の分を読み直す)
    act(() => {
      onStatus('CHANNEL_ERROR')
      onStatus('SUBSCRIBED')
      vi.advanceTimersByTime(300)
    })
    await waitFor(() => expect(order).toHaveBeenCalledTimes(3))
    vi.useRealTimers()
  })
})
