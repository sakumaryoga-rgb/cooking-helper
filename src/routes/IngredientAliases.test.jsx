import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { IngredientAliases } from './IngredientAliases'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
const refreshIngredients = vi.fn()
const refreshRecipes = vi.fn()
let fridge = []
vi.mock('@/hooks/useIngredients', () => ({ useIngredients: () => ({ ingredients: fridge, refresh: refreshIngredients }) }))
vi.mock('@/hooks/useRecipes', () => ({ useRecipes: () => ({ recipes: [], refresh: refreshRecipes }) }))
vi.mock('@/hooks/useIngredientCatalog', () => ({
  useIngredientCatalog: () => ({ catalog: [{ id: 'c-potato', name: 'じゃがいも' }, { id: 'c-carrot', name: 'にんじん' }] }),
}))
const refresh = vi.fn()
vi.mock('@/hooks/useIngredientAliases', () => ({
  useIngredientAliases: () => ({
    aliases: [
      { alias: 'メークイン', catalog_id: 'c-potato', group_id: 'g1' },
      { alias: '男爵いも', catalog_id: 'c-potato', group_id: 'g1' },
      { alias: '人参', catalog_id: 'c-carrot', group_id: 'g1' },
      { alias: 'じゃが芋', catalog_id: 'c-potato', group_id: null },
      { alias: 'ニンジン', catalog_id: 'c-carrot', group_id: 'g-other' },
    ],
    refresh,
  }),
}))

function renderPage() {
  return render(<MemoryRouter><IngredientAliases groupId="g1" /></MemoryRouter>)
}

describe('覚えた食材の別名(設定から開く別ページ)', () => {
  it('この家の別名だけを食材ごとにまとめて出し、設定へ戻れる', () => {
    renderPage()
    expect(screen.getByRole('link', { name: '設定' })).toHaveAttribute('href', '/settings')
    expect(screen.getByText('3件')).toBeInTheDocument()
    expect(screen.getByText('じゃがいも')).toBeInTheDocument()
    expect(screen.getByText('メークイン')).toBeInTheDocument()
    expect(screen.getByText('人参')).toBeInTheDocument()
    expect(screen.queryByText('じゃが芋')).not.toBeInTheDocument()
    expect(screen.queryByText('ニンジン')).not.toBeInTheDocument()
  })

  it('別名・食材名で絞り込める', async () => {
    renderPage()
    await userEvent.type(screen.getByRole('searchbox', { name: '別名を探す' }), 'にんじん')
    expect(screen.getByText('人参')).toBeInTheDocument()
    expect(screen.queryByText('メークイン')).not.toBeInTheDocument()
  })

  it('忘れると、この家の別名だけを消す', async () => {
    const del = { eq: vi.fn() }
    del.eq.mockReturnValueOnce(del).mockResolvedValueOnce({ error: null })
    supabase.from.mockReturnValue({ delete: () => del })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '「メークイン」を忘れる' }))
    expect(supabase.from).toHaveBeenCalledWith('ingredient_aliases')
    expect(del.eq).toHaveBeenCalledWith('group_id', 'g1')
    expect(del.eq).toHaveBeenCalledWith('alias', 'メークイン')
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})

describe('同じ食材をまとめる', () => {
  it('表記揺れの候補を出し、確かめてから merge_ingredients でまとめて読み直す', async () => {
    fridge = [
      { id: 'i1', name: '豚バラ', unit: 'g', quantity: 200 },
      { id: 'i2', name: '豚バラ肉', unit: 'g', quantity: 0 },
      { id: 'i3', name: '卵', unit: '個', quantity: 6 },
    ]
    supabase.rpc.mockResolvedValue({ data: 'i1', error: null })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '豚バラ肉 → 豚バラ' }))
    expect(screen.getByRole('alert')).toHaveTextContent('「豚バラ肉」(在庫なし(g))を「豚バラ」(在庫 200g)にまとめます')
    await userEvent.click(screen.getByRole('button', { name: 'まとめる' }))
    expect(supabase.rpc).toHaveBeenCalledWith('merge_ingredients', { p_keep: 'i1', p_drop: 'i2' })
    expect(await screen.findByText(/次から「豚バラ肉」は自動で「豚バラ」になります/)).toBeInTheDocument()
    expect(refreshIngredients).toHaveBeenCalled()
    expect(refreshRecipes).toHaveBeenCalled()
  })

  it('単位が違って在庫がある食材は、まとめる前に止める', async () => {
    fridge = [
      { id: 'i3', name: '卵', unit: '個', quantity: 6 },
      { id: 'i4', name: 'たまご', unit: 'パック', quantity: 1 },
    ]
    renderPage()
    await userEvent.selectOptions(screen.getByLabelText('まとめる(消える)食材'), 'i4')
    await userEvent.selectOptions(screen.getByLabelText('残す食材'), 'i3')
    expect(screen.getByText(/単位が違います\(パックと個\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /にまとめる$/ })).not.toBeInTheDocument()
  })
})
