import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShoppingList } from './ShoppingList'
import { supabase } from '@/supabaseClient'

const eq = vi.fn().mockResolvedValue({ error: null })
const update = vi.fn(() => ({ eq }))
vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn(() => ({ update })) } }))

describe('買い物リスト', () => {
  it('「なくなった」とマークした食材だけを出し、買ったら外す(在庫が0の食材は自動で入れない)', async () => {
    const changed = vi.fn()
    render(
      <ShoppingList
        onChanged={changed}
        ingredients={[
          { id: 's', name: '塩', quantity: 0, is_staple: true, restock_requested_at: '2026-10-11T10:00:00Z' },
          { id: 'e', name: '卵', quantity: 0, is_staple: false, restock_requested_at: null },
        ]}
      />
    )
    expect(screen.getByText('塩')).toBeInTheDocument()
    expect(screen.queryByText('卵')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '塩を買った' }))
    expect(supabase.from).toHaveBeenCalledWith('ingredients')
    expect(update).toHaveBeenCalledWith({ restock_requested_at: null })
    expect(eq).toHaveBeenCalledWith('id', 's')
    await waitFor(() => expect(changed).toHaveBeenCalled())
  })

  it('空のときは、入れ方を案内する', () => {
    render(<ShoppingList ingredients={[]} />)
    expect(screen.getByText(/買い足すものはありません/)).toBeInTheDocument()
  })
})
