import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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

function setup(ingredients, catalog = []) {
  useIngredients.mockReturnValue({ ingredients, loading: false, refresh: vi.fn(), removeIngredient, dropLocal })
  useIngredientBatches.mockReturnValue({ batches: [] })
  useIngredientCatalog.mockReturnValue({ catalog })
  return render(<MemoryRouter><Fridge groupId="g1" /></MemoryRouter>)
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
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', {
      p_ingredient_id: 'i1',
      p_delta: 10,
      p_dated_today: true,
      p_best_before: null,
      p_use_by: null,
    })
  })

  it('個の食材は－で1減らす', async () => {
    setup([{ id: 'i2', name: '卵', unit: '個', quantity: 4 }])
    await userEvent.click(screen.getByRole('button', { name: '減らす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', {
      p_ingredient_id: 'i2',
      p_delta: -1,
      p_dated_today: true,
      p_best_before: null,
      p_use_by: null,
    })
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

  it('追加で選んで、量を決めずに閉じた在庫0の食材は冷蔵庫に出さず片付ける', async () => {
    setup([{ id: 'b', name: 'しょうゆ', unit: 'ml', quantity: 0 }])
    await act(async () => pickerProps.onSelect({ id: 'b', name: 'しょうゆ', unit: 'ml', quantity: 0 }))
    expect(await screen.findByRole('dialog', { name: 'しょうゆ を冷蔵庫に入れる' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByText('しょうゆ')).not.toBeInTheDocument()
    expect(removeIngredient).toHaveBeenCalledWith('b')
  })

  it('追加で選んで在庫を入れた食材は片付けない', async () => {
    setup([{ id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 }])
    await act(async () => pickerProps.onSelect({ id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 }))
    await userEvent.click(await screen.findByRole('button', { name: '在庫を増やす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', expect.objectContaining({ p_ingredient_id: 'p', p_delta: 1, p_dated_today: true }))
    expect(removeIngredient).not.toHaveBeenCalled()
  })

  it('在庫のある食材を選び直して閉じても片付けない', async () => {
    setup([{ id: 'e', name: '卵', unit: '個', quantity: 4 }])
    await act(async () => pickerProps.onSelect({ id: 'e', name: '卵', unit: '個', quantity: 4 }))
    await userEvent.click(await screen.findByRole('button', { name: 'キャンセル' }))
    expect(removeIngredient).not.toHaveBeenCalled()
  })

  it('「追加日を購入日にする」の切り替えはない', () => {
    setup([{ id: 'e', name: '卵', unit: '個', quantity: 4 }])
    expect(screen.queryByText('追加日を購入日にする')).not.toBeInTheDocument()
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
    render(<MemoryRouter><Fridge groupId="g1" /></MemoryRouter>)
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

describe('常備品と分数の在庫', () => {
  const SEASONING = [{ id: 'c-soy', name: '醤油', category: '調味料・油' }]
  let update
  let eq
  let inIds

  beforeEach(() => {
    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValue({ data: [{ new_quantity: 1, deleted: false }], error: null })
    eq = vi.fn().mockResolvedValue({ error: null })
    inIds = vi.fn().mockResolvedValue({ error: null })
    update = vi.fn(() => ({ eq, in: inIds }))
    supabase.from.mockReturnValue({ update })
  })

  it('調味料を追加すると「常備品にする」が選ばれていて、数を入れずに常備品にできる', async () => {
    setup([{ id: 's', name: '醤油', unit: 'ml', quantity: 0, catalog_id: 'c-soy' }], SEASONING)
    await act(async () => pickerProps.onSelect({ id: 's', name: '醤油', unit: 'ml', quantity: 0, catalog_id: 'c-soy' }))
    expect(await screen.findByRole('radio', { name: /常備品にする/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByLabelText('量')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '常備品にする' }))
    expect(update).toHaveBeenCalledWith({ is_staple: true })
    expect(eq).toHaveBeenCalledWith('id', 's')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('じゃがいも 1/2 は 0.5 として在庫に入る', async () => {
    setup([{ id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 }])
    await act(async () => pickerProps.onSelect({ id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 }))
    const input = await screen.findByLabelText('量')
    await userEvent.clear(input)
    await userEvent.type(input, '1/2')
    expect(screen.getByText('= 0.5')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '在庫を増やす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', expect.objectContaining({ p_ingredient_id: 'p', p_delta: 0.5 }))
  })

  it('分数ボタンで端数を入れられる(2 → 2と1/4 = 2.25)', async () => {
    setup([{ id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 }])
    await act(async () => pickerProps.onSelect({ id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 }))
    const input = await screen.findByLabelText('量')
    await userEvent.clear(input)
    await userEvent.type(input, '2')
    await userEvent.click(screen.getByRole('button', { name: '端数を1/4にする' }))
    expect(input).toHaveValue('2と1/4')
    await userEvent.click(screen.getByRole('button', { name: '在庫を増やす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', expect.objectContaining({ p_delta: 2.25 }))
  })

  it('常備品は別の棚に出て＋－がなく、「数を記録する」で戻せる', async () => {
    setup([
      { id: 's', name: '塩', unit: 'g', quantity: 0, is_staple: true },
      { id: 'e', name: '卵', unit: '個', quantity: 2 },
    ])
    const shelf = screen.getByRole('region', { name: '常備品' })
    expect(shelf).toHaveTextContent('塩')
    expect(screen.getAllByRole('button', { name: '減らす' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /塩/ }))
    await userEvent.click(screen.getByRole('button', { name: /数を記録する/ }))
    expect(update).toHaveBeenCalledWith({ is_staple: false })
    expect(inIds).toHaveBeenCalledWith('id', ['s'])
  })

  it('数を記録している調味料を、確認してからまとめて常備品にできる', async () => {
    setup(
      [
        { id: 's', name: '醤油', unit: 'ml', quantity: 500, catalog_id: 'c-soy' },
        { id: 'e', name: '卵', unit: '個', quantity: 2 },
      ],
      SEASONING
    )
    await userEvent.click(screen.getByRole('button', { name: 'まとめて常備品にする' }))
    expect(update).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '醤油を常備品に' }))
    expect(inIds).toHaveBeenCalledWith('id', ['s'])
  })

  it('残りとほぼ同じ量を減らすときは、端数を残さず使い切る', async () => {
    setup([{ id: 'p', name: 'じゃがいも', unit: '個', quantity: 1.000001 }])
    await userEvent.click(screen.getByRole('button', { name: '減らす' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', expect.objectContaining({ p_delta: -1.000001 }))
  })
})

describe('追加で既存の食材を選び直したとき(重複登録しない)', () => {
  const SEASONING = [{ id: 'c-soy', name: '醤油', category: '調味料・油' }]
  let update
  let eq

  beforeEach(() => {
    supabase.rpc.mockReset()
    eq = vi.fn().mockResolvedValue({ error: null })
    update = vi.fn(() => ({ eq, in: vi.fn().mockResolvedValue({ error: null }) }))
    supabase.from.mockReturnValue({ update })
  })

  it('すでに常備品なら、ダイアログを開かずに常備品の棚で見せる', async () => {
    setup([{ id: 's', name: '塩', unit: 'g', quantity: 0, is_staple: true }])
    await act(async () => pickerProps.onSelect({ id: 's', name: '塩', unit: 'g', quantity: 0, is_staple: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('塩は常備品です')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('在庫を数えている調味料は「数を記録する」のまま。常備品にしても在庫は消さない', async () => {
    const soy = { id: 's', name: '醤油', unit: 'ml', quantity: 500, catalog_id: 'c-soy' }
    setup([soy], SEASONING)
    await act(async () => pickerProps.onSelect(soy))
    expect(await screen.findByRole('radio', { name: /数を記録する/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: /常備品にする/ }))
    expect(screen.getByText(/いまの在庫\(500ml\)は消さずに残します/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '常備品にする' }))
    expect(update).toHaveBeenCalledWith({ is_staple: true })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe('複数の食材をまとめて入れる', () => {
  const SEASONING = [{ id: 'c-soy', name: '醤油', category: '調味料・油' }]
  let inIds

  beforeEach(() => {
    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValue({ data: [{ new_quantity: 1, deleted: false }], error: null })
    inIds = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ update: vi.fn(() => ({ in: inIds, eq: vi.fn() })) })
  })

  it('個は1、g は空欄、調味料は常備品で始まり、1回で全部入る', async () => {
    const list = [
      { id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 },
      { id: 'm', name: '豚こま', unit: 'g', quantity: 0 },
      { id: 's', name: '醤油', unit: 'ml', quantity: 0, catalog_id: 'c-soy' },
    ]
    setup(list, SEASONING)
    await act(async () => pickerProps.onSelectMany(list))
    expect(await screen.findByRole('dialog', { name: '3品を冷蔵庫に入れる' })).toBeInTheDocument()
    expect(screen.getByLabelText('じゃがいもの量')).toHaveValue('1')
    expect(screen.getByLabelText('豚こまの量')).toHaveValue('')
    expect(screen.getByRole('radio', { name: '醤油を常備品にする' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.type(screen.getByLabelText('豚こまの量'), '200')
    await userEvent.clear(screen.getByLabelText('じゃがいもの量'))
    await userEvent.type(screen.getByLabelText('じゃがいもの量'), '1/2')
    await userEvent.click(screen.getByRole('button', { name: '冷蔵庫に入れる' }))
    expect(inIds).toHaveBeenCalledWith('id', ['s'])
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', expect.objectContaining({ p_ingredient_id: 'p', p_delta: 0.5 }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', expect.objectContaining({ p_ingredient_id: 'm', p_delta: 200 }))
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('量を空欄のままにした食材は、閉じたときに片付ける', async () => {
    removeIngredient.mockReset()
    const list = [
      { id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 },
      { id: 'm', name: '豚こま', unit: 'g', quantity: 0 },
    ]
    setup(list)
    await act(async () => pickerProps.onSelectMany(list))
    await userEvent.click(await screen.findByRole('button', { name: '冷蔵庫に入れる' }))
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', expect.objectContaining({ p_ingredient_id: 'p' }))
    expect(removeIngredient).toHaveBeenCalledWith('m')
    expect(removeIngredient).not.toHaveBeenCalledWith('p')
  })

  it('1品だけ選んだときは、これまでどおりのダイアログ', async () => {
    const one = { id: 'p', name: 'じゃがいも', unit: '個', quantity: 0 }
    setup([one])
    await act(async () => pickerProps.onSelectMany([one]))
    expect(await screen.findByRole('dialog', { name: 'じゃがいも を冷蔵庫に入れる' })).toBeInTheDocument()
  })
})
