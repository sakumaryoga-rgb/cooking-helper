import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IngredientPicker } from './IngredientPicker'
import { supabase } from '@/supabaseClient'

// cmdk(食材の検索一覧)が使うブラウザの API を、テスト環境で補う
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView ??= () => {}

vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn() } }))
vi.mock('@/hooks/useIngredientAliases', () => ({ useIngredientAliases: () => ({ aliases: [] }) }))
vi.mock('@/hooks/useIngredientCatalog', () => ({
  useIngredientCatalog: () => ({
    loading: false,
    catalog: [
      { id: 'c-potato', name: 'じゃがいも', unit: '個', category: '根菜類', sort_order: 1, group_id: null },
      { id: 'c-carrot', name: 'にんじん', unit: '本', category: '根菜類', sort_order: 2, group_id: null },
    ],
  }),
}))

const fridge = [
  { id: 'i-potato', name: 'じゃがいも', unit: '個', quantity: 3, catalog_id: 'c-potato' },
  { id: 'i-old', name: '自家製ジャム', unit: '個', quantity: 1, catalog_id: null },
]

function renderPicker(props = {}) {
  const onSelect = vi.fn()
  render(<IngredientPicker open onOpenChange={() => {}} groupId="g1" ingredients={fridge} onSelect={onSelect} {...props} />)
  return onSelect
}

describe('食材を選ぶ画面', () => {
  it('登録済みの欄はなく、冷蔵庫にある食材もカテゴリの中に在庫つきで出る', async () => {
    renderPicker()
    expect(screen.queryByText('登録済みの食材')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /根菜類/ }))
    expect(screen.getByText('じゃがいも')).toBeInTheDocument()
    expect(screen.getByText('冷蔵庫に 3個')).toBeInTheDocument()
    expect(screen.getByText('にんじん')).toBeInTheDocument()
  })

  it('冷蔵庫にある食材を選ぶと、新しく作らずにその行を返す', async () => {
    const onSelect = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: /根菜類/ }))
    await userEvent.click(screen.getByText('じゃがいも'))
    expect(onSelect).toHaveBeenCalledWith(fridge[0])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('食材マスタに結び付いていない冷蔵庫の食材は「その他」に出る', async () => {
    const onSelect = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: /その他/ }))
    await userEvent.click(screen.getByText('自家製ジャム'))
    expect(onSelect).toHaveBeenCalledWith(fridge[1])
  })

  it('リストにない食材として、表記だけ違う食材を登録しようとしたら冷蔵庫の食材を使う', async () => {
    const onSelect = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: 'リストにない食材を追加' }))
    await userEvent.type(screen.getByLabelText('食材名'), 'じゃが芋')
    await userEvent.click(screen.getByRole('button', { name: '追加して選択' }))
    expect(onSelect).toHaveBeenCalledWith(fridge[0])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('レシピで使っている材料は選べない', async () => {
    const onSelect = renderPicker({ excludeIds: ['i-potato'] })
    await userEvent.click(screen.getByRole('button', { name: /根菜類/ }))
    await userEvent.click(screen.getByText('じゃがいも'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
