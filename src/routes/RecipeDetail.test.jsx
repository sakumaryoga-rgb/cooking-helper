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

  it('調理の確定で、調整した使用量を cook_recipe に渡し在庫を再取得する', async () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 300 },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
    const dialog = await screen.findByRole('dialog')
    expect(getState().busy).toBe(true)

    const [chickenInput] = within(dialog).getAllByRole('spinbutton')
    await userEvent.clear(chickenInput)
    await userEvent.type(chickenInput, '150')
    await userEvent.click(within(dialog).getByRole('button', { name: '確定' }))

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('cook_recipe', {
        p_recipe_id: 'r1',
        p_used: { chicken: '150', egg: 2 },
      })
    )
    await waitFor(() => expect(refreshIngredients).toHaveBeenCalled())
    await waitFor(() => expect(getState().busy).toBe(false))
  })
})
