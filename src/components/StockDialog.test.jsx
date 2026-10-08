import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StockDialog } from './StockDialog'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))

const ingredient = { id: 'i1', name: '牛乳', unit: 'ml' }

describe('期限つきで在庫を増やす', () => {
  beforeEach(() => {
    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValue({ error: null })
  })

  it('賞味期限か消費期限のどちらか一方だけを送る', async () => {
    const onClose = vi.fn()
    render(<StockDialog ingredient={ingredient} defaultQuantity={10} datedToday onClose={onClose} />)
    await userEvent.click(screen.getByRole('radio', { name: '賞味期限' }))
    await userEvent.type(screen.getByLabelText('期限の日付'), '2026-10-20')
    await userEvent.click(screen.getByRole('radio', { name: '消費期限' }))
    await userEvent.click(screen.getByRole('button', { name: '在庫を増やす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', {
      p_ingredient_id: 'i1',
      p_delta: 10,
      p_dated_today: true,
      p_best_before: null,
      p_use_by: '2026-10-20',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('期限の種類を選んで日付がなければ送らない', async () => {
    render(<StockDialog ingredient={ingredient} defaultQuantity={10} datedToday onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: '消費期限' }))
    await userEvent.click(screen.getByRole('button', { name: '在庫を増やす' }))
    expect(screen.getByText('期限の日付を入力してください')).toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
