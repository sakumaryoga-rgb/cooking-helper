import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
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
let pickerProps = null
vi.mock('@/components/IngredientPicker', () => ({
  IngredientPicker: (props) => {
    pickerProps = props
    return null
  },
}))

const removeIngredient = vi.fn()
const dropLocal = vi.fn()

function setup(ingredients) {
  useIngredients.mockReturnValue({ ingredients, loading: false, removeIngredient, dropLocal })
  useIngredientBatches.mockReturnValue({ batches: [] })
  useIngredientCatalog.mockReturnValue({ catalog: [] })
  return render(<Fridge groupId="g1" />)
}

describe('Fridge の数量変更', () => {
  beforeEach(() => {
    removeIngredient.mockReset()
    dropLocal.mockReset()
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
    await waitFor(() => expect(dropLocal).toHaveBeenCalledWith('i3'))
    expect(removeIngredient).not.toHaveBeenCalled()
  })

  it('RPCがエラーなら一覧から消さない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    setup([{ id: 'i3', name: '大葉', unit: '枚', quantity: 1 }])
    await userEvent.click(screen.getByRole('button', { name: '減らす' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled())
    expect(removeIngredient).not.toHaveBeenCalled()
    expect(dropLocal).not.toHaveBeenCalled()
  })

  it('在庫0の食材(レシピの材料)は折りたたみ、開くと表示する', async () => {
    setup([
      { id: 'a', name: 'にんじん', unit: '本', quantity: 1 },
      { id: 'b', name: 'しょうゆ', unit: 'ml', quantity: 0 },
    ])
    expect(screen.getByText('にんじん')).toBeInTheDocument()
    expect(screen.queryByText('しょうゆ')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '在庫なしの食材(1)を表示' }))
    expect(screen.getByText('しょうゆ')).toBeInTheDocument()
  })

  it('在庫0の食材を「追加」で選び直すと通常の一覧に出て、「＋」で再追加できる', async () => {
    setup([{ id: 'b', name: 'しょうゆ', unit: 'ml', quantity: 0 }])
    expect(screen.queryByText('しょうゆ')).not.toBeInTheDocument()
    await act(async () => pickerProps.onSelect({ id: 'b', name: 'しょうゆ', unit: 'ml', quantity: 0 }))
    // 選んだ直後に、量と期限を入れるダイアログが開く
    expect(await screen.findByRole('dialog', { name: 'しょうゆ を増やす' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByText('しょうゆ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /在庫なしの食材/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '増やす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_ingredient_quantity', expect.objectContaining({ p_ingredient_id: 'b' }))
  })

  it('期限切れ・推定・未設定を区別して表示し、期限の近い順に並べ、ロットを開ける', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
    useIngredientBatches.mockReturnValue({
      batches: [
        { id: 'b1', ingredient_id: 'milk', quantity: 500, added_on: '2026-10-01', use_by: '2026-10-07' },
        { id: 'b2', ingredient_id: 'egg', quantity: 6, added_on: '2026-10-07', best_before: null, use_by: null },
      ],
    })
    useIngredients.mockReturnValue({
      ingredients: [
        { id: 'rice', name: '米', unit: 'g', quantity: 1000 },
        { id: 'egg', name: '卵', unit: '個', quantity: 6 },
        { id: 'milk', name: '牛乳', unit: 'ml', quantity: 500 },
      ],
      loading: false,
      removeIngredient,
      dropLocal,
    })
    useIngredientCatalog.mockReturnValue({ catalog: [] })
    render(<Fridge groupId="g1" />)
    const names = screen.getAllByRole('button', { expanded: false }).map((b) => b.textContent)
    expect(names[0]).toMatch(/^牛乳.*消費期限 10\/7・期限切れ/)
    expect(names[1]).toMatch(/^卵.*推定 10\/14・あと6日/)
    expect(names[2]).toMatch(/^米.*期限未設定/)
    await userEvent.click(screen.getByRole('button', { name: /^卵/ }))
    expect(screen.getByRole('list', { name: '卵のロット' })).toHaveTextContent('6個・10/7購入')
    vi.useRealTimers()
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
