import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Fridge } from './Fridge'
import { supabase } from '@/supabaseClient'
import { useIngredients } from '@/hooks/useIngredients'
import { useIngredientBatches } from '@/hooks/useIngredientBatches'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }))
vi.mock('@/hooks/useIngredients', () => ({ useIngredients: vi.fn() }))
vi.mock('@/hooks/useIngredientBatches', () => ({ useIngredientBatches: vi.fn() }))
vi.mock('@/hooks/useIngredientCatalog', () => ({ useIngredientCatalog: vi.fn() }))
// 食材選択ダイアログはこのテストの対象外(閉じたまま)
vi.mock('@/components/IngredientPicker', () => ({ IngredientPicker: () => null }))

const removeIngredient = vi.fn()

function setup(ingredients) {
  useIngredients.mockReturnValue({ ingredients, loading: false, removeIngredient })
  useIngredientBatches.mockReturnValue({ batches: [] })
  useIngredientCatalog.mockReturnValue({ catalog: [] })
  return render(<Fridge groupId="g1" />)
}

describe('Fridge の数量変更', () => {
  beforeEach(() => {
    removeIngredient.mockReset()
    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValue({ data: [{ new_quantity: 1, deleted: false }], error: null })
  })

  it('g の食材は＋で10増やし、追加日を今日として記録する', async () => {
    setup([{ id: 'i1', name: '鶏もも肉', unit: 'g', quantity: 200 }])
    await userEvent.click(screen.getByRole('button', { name: '増やす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_ingredient_quantity', {
      p_ingredient_id: 'i1',
      p_delta: 10,
      p_dated_today: true,
    })
  })

  it('個の食材は－で1減らす', async () => {
    setup([{ id: 'i2', name: '卵', unit: '個', quantity: 4 }])
    await userEvent.click(screen.getByRole('button', { name: '減らす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_ingredient_quantity', {
      p_ingredient_id: 'i2',
      p_delta: -1,
      p_dated_today: true,
    })
  })

  it('「追加日を購入日にする」をオフにすると日付なしで記録する', async () => {
    setup([{ id: 'i2', name: '卵', unit: '個', quantity: 4 }])
    await userEvent.click(screen.getByRole('switch'))
    await userEvent.click(screen.getByRole('button', { name: '増やす' }))
    expect(supabase.rpc).toHaveBeenLastCalledWith('adjust_ingredient_quantity', expect.objectContaining({ p_dated_today: false }))
  })

  it('RPCが在庫0で削除したと返したら、一覧からも消す', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ new_quantity: 0, deleted: true }], error: null })
    setup([{ id: 'i3', name: '大葉', unit: '枚', quantity: 1 }])
    await userEvent.click(screen.getByRole('button', { name: '減らす' }))
    await waitFor(() => expect(removeIngredient).toHaveBeenCalledWith('i3'))
  })

  it('RPCがエラーなら一覧から消さない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    setup([{ id: 'i3', name: '大葉', unit: '枚', quantity: 1 }])
    await userEvent.click(screen.getByRole('button', { name: '減らす' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled())
    expect(removeIngredient).not.toHaveBeenCalled()
  })

  it('検索語で一覧を絞り込む', async () => {
    setup([
      { id: 'a', name: 'にんじん', unit: '本', quantity: 1 },
      { id: 'b', name: 'ピーマン', unit: '個', quantity: 4 },
    ])
    await userEvent.type(screen.getByPlaceholderText('食材を検索'), 'ピー')
    expect(screen.queryByText('にんじん')).not.toBeInTheDocument()
    expect(screen.getByText('ピーマン')).toBeInTheDocument()
  })
})
