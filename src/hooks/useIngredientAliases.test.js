import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useIngredientAliasesSource } from './useIngredientAliases'
import { notifyAliasesChanged } from '@/lib/aliasEvents'

const select = vi.fn()
vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn(() => ({ select })) } }))

describe('食材の別名の読み込み', () => {
  it('別名を覚えたと知らされたら読み直す(リアルタイムの通知を受けないため)', async () => {
    select.mockResolvedValueOnce({ data: [], error: null })
    const { result } = renderHook(() => useIngredientAliasesSource('g1'))
    await waitFor(() => expect(select).toHaveBeenCalledTimes(1))
    select.mockResolvedValueOnce({ data: [{ alias: '長ナス', catalog_id: 'c-nasu', group_id: 'g1' }], error: null })
    act(() => notifyAliasesChanged())
    await waitFor(() => expect(result.current.aliases).toEqual([{ alias: '長ナス', catalog_id: 'c-nasu', group_id: 'g1' }]))
  })

  it('使わないとき(共有元がある)は読み込まず、知らせにも反応しない', async () => {
    select.mockClear()
    renderHook(() => useIngredientAliasesSource('g1', false))
    act(() => notifyAliasesChanged())
    await new Promise((r) => setTimeout(r, 10))
    expect(select).not.toHaveBeenCalled()
  })

  it('共通の別名と選んでいる家の別名だけを使う(所属している別の家の別名は使わない)', async () => {
    select.mockResolvedValueOnce({
      data: [
        { alias: '人参', catalog_id: 'c1', group_id: null },
        { alias: 'メークイン', catalog_id: 'c2', group_id: 'g1' },
        { alias: '実家の呼び名', catalog_id: 'c3', group_id: 'g2' },
      ],
      error: null,
    })
    const { result } = renderHook(() => useIngredientAliasesSource('g1'))
    await waitFor(() => expect(result.current.aliases.map((a) => a.alias)).toEqual(['人参', 'メークイン']))
  })
})
