import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useIngredientAliasesSource } from './useIngredientAliases'
import { notifyAliasesChanged } from '@/lib/aliasEvents'

const select = vi.fn()
vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn(() => ({ select })) } }))

describe('食材の別名の読み込み', () => {
  it('別名を覚えたと知らされたら読み直す(リアルタイムの通知を受けないため)', async () => {
    select.mockResolvedValueOnce({ data: [], error: null })
    const { result } = renderHook(() => useIngredientAliasesSource())
    await waitFor(() => expect(select).toHaveBeenCalledTimes(1))
    select.mockResolvedValueOnce({ data: [{ alias: '長ナス', catalog_id: 'c-nasu', group_id: 'g1' }], error: null })
    act(() => notifyAliasesChanged())
    await waitFor(() => expect(result.current.aliases).toEqual([{ alias: '長ナス', catalog_id: 'c-nasu', group_id: 'g1' }]))
  })

  it('使わないとき(共有元がある)は読み込まず、知らせにも反応しない', async () => {
    select.mockClear()
    renderHook(() => useIngredientAliasesSource(false))
    act(() => notifyAliasesChanged())
    await new Promise((r) => setTimeout(r, 10))
    expect(select).not.toHaveBeenCalled()
  })
})
