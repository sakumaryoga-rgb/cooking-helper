import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { IngredientAliases } from './IngredientAliases'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn() } }))
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
