import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RecipeDetail } from './RecipeDetail'
import { supabase } from '@/supabaseClient'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { __resetForTests, getState } from '@/lib/swUpdate'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('@/hooks/useIngredients', () => ({ useIngredients: vi.fn() }))
vi.mock('@/hooks/useRecipes', () => ({ useRecipes: vi.fn() }))
vi.mock('@/hooks/useIngredientCatalog', () => ({
  useIngredientCatalog: () => ({ catalog: [{ id: 'c-thigh', name: '鶏もも肉', unit: 'g' }, { id: 'c-breast', name: '鶏むね肉', unit: 'g' }] }),
}))
const disableRule = vi.fn()
vi.mock('@/hooks/useSubstitutions', () => ({
  useSubstitutions: () => ({ rules: [{ id: 'rule1', from_catalog_id: 'c-thigh', to_catalog_id: 'c-breast', ratio: 1, note: null }], disableRule }),
}))
const refreshLogs = vi.fn()
let cookLogs = []
vi.mock('@/hooks/useCookLogs', () => ({ useCookLogs: () => ({ logs: cookLogs, refresh: refreshLogs }) }))

const refreshIngredients = vi.fn()
const recipe = {
  id: 'r1',
  title: '親子丼',
  url: 'https://example.com/oyakodon',
  recipe_ingredients: [
    { id: 'l1', ingredient_id: 'chicken', required_quantity: 200, ingredient: { id: 'chicken', name: '鶏もも肉', unit: 'g' } },
    { id: 'l2', ingredient_id: 'egg', required_quantity: 2, ingredient: { id: 'egg', name: '卵', unit: '個' } },
  ],
}

function setup(stock) {
  useIngredients.mockReturnValue({ ingredients: stock, refresh: refreshIngredients })
  useRecipes.mockReturnValue({ recipes: [recipe], loading: false })
  return render(
    <MemoryRouter initialEntries={['/recipes/r1']}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipeDetail groupId="g1" />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RecipeDetail', () => {
  beforeEach(() => {
    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValue({ error: null })
    refreshIngredients.mockReset()
  })
  afterEach(() => __resetForTests())

  it('材料が揃っていれば「作れます」と表示する', () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 300 },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    expect(screen.getByText('作れます')).toBeInTheDocument()
    expect(screen.getByText(/必要 200g \/ 在庫 300g/)).toBeInTheDocument()
  })

  it('不足があれば不足品目数を表示する', () => {
    setup([{ id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 100 }])
    expect(screen.getByText('あと2品')).toBeInTheDocument()
  })

  it('調理の確定で、調整した使用量と送信IDを cook_recipe_v2 に渡し、在庫と記録を再取得する', async () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 300 },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
    const dialog = await screen.findByRole('dialog')
    expect(getState().busy).toBe(true)

    const chickenInput = within(dialog).getByLabelText('鶏もも肉の使用量')
    await userEvent.clear(chickenInput)
    await userEvent.type(chickenInput, '150')
    await userEvent.click(within(dialog).getByRole('button', { name: '確定' }))

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('cook_recipe_v2', {
        p_recipe_id: 'r1',
        p_items: [
          { ingredient_id: 'chicken', quantity: 150, substitute_for: null },
          { ingredient_id: 'egg', quantity: 2, substitute_for: null },
        ],
        p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      })
    )
    await waitFor(() => expect(refreshIngredients).toHaveBeenCalled())
    expect(refreshLogs).toHaveBeenCalled()
    await waitFor(() => expect(getState().busy).toBe(false))
  })

  it('足りない材料を代替で補えれば「代替で作れます」と出し、確定で代替先の在庫を使う', async () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 50, catalog_id: 'c-thigh' },
      { id: 'breast', name: '鶏むね肉', unit: 'g', quantity: 300, catalog_id: 'c-breast' },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    expect(screen.getByText('代替で作れます')).toBeInTheDocument()
    expect(screen.getByText(/代わりに 鶏むね肉 150g/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/鶏もも肉の代わり/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '確定' }))
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith(
        'cook_recipe_v2',
        expect.objectContaining({
          p_items: [
            { ingredient_id: 'chicken', quantity: 50, substitute_for: null },
            { ingredient_id: 'breast', quantity: 150, substitute_for: '鶏もも肉' },
            { ingredient_id: 'egg', quantity: 2, substitute_for: null },
          ],
        })
      )
    )
  })

  it('代替を使わないことにできる', async () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 50, catalog_id: 'c-thigh' },
      { id: 'breast', name: '鶏むね肉', unit: 'g', quantity: 300, catalog_id: 'c-breast' },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    await userEvent.click(screen.getByRole('button', { name: 'この代替を使わない' }))
    expect(disableRule).toHaveBeenCalledWith('rule1')
  })

  it('最近作った記録を取り消せる', async () => {
    cookLogs = [{ id: 'log1', created_at: '2026-10-08T12:00:00Z', cook_log_items: [{ ingredient_name: '鶏もも肉', used_quantity: 200, unit: 'g' }] }]
    setup([{ id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 100 }])
    expect(screen.getByText('鶏もも肉 200g')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('undo_cook', { p_cook_log_id: 'log1' }))
    expect(refreshIngredients).toHaveBeenCalled()
    cookLogs = []
  })
})
