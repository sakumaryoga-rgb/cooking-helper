import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useIngredients } from './useIngredients'
import { supabase } from '@/supabaseClient'

const rows = [
  { id: 'used', name: '鶏むね肉', unit: 'g', quantity: 300 },
  { id: 'unused', name: '大葉', unit: '枚', quantity: 5 },
]

vi.mock('@/supabaseClient', () => {
  const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: rows, error: null }) }
  const channel = { on: () => channel, subscribe: () => channel }
  return { supabase: { from: () => chain, rpc: vi.fn(), channel: () => channel, removeChannel: vi.fn() } }
})

describe('冷蔵庫からの削除', () => {
  beforeEach(() => supabase.rpc.mockReset())

  it('レシピで使う食材は在庫0で残し、使わない食材は一覧から消す', async () => {
    const { result } = renderHook(() => useIngredients('g1'))
    await waitFor(() => expect(result.current.ingredients).toHaveLength(2))

    supabase.rpc.mockResolvedValueOnce({ data: false, error: null })
    await act(() => result.current.removeIngredient('used'))
    expect(supabase.rpc).toHaveBeenCalledWith('remove_ingredient', { p_ingredient_id: 'used' })
    expect(result.current.ingredients.find((i) => i.id === 'used')).toMatchObject({ quantity: 0 })

    supabase.rpc.mockResolvedValueOnce({ data: true, error: null })
    await act(() => result.current.removeIngredient('unused'))
    expect(result.current.ingredients.find((i) => i.id === 'unused')).toBeUndefined()
  })
})
