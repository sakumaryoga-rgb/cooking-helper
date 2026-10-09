import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RecipeEdit } from './RecipeEdit'
import { updateRecipe } from '@/lib/recipeImport/save'

vi.mock('@/supabaseClient', () => ({ supabase: {} }))
vi.mock('@/components/IngredientPicker', () => ({ IngredientPicker: () => null }))
vi.mock('@/lib/recipeImport/save', () => ({ updateRecipe: vi.fn() }))
const fridge = [{ id: 'egg', name: '卵', unit: '個', quantity: 6 }]
vi.mock('@/hooks/useIngredients', () => ({ useIngredients: () => ({ ingredients: fridge }) }))
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({
    loading: false,
    recipes: [
      {
        id: 'r1',
        title: 'だし巻き卵',
        url: 'https://example.com/r',
        servings: 2,
        instructions: '溶く',
        memo: null,
        icon: null,
        recipe_ingredients: [{ id: 'l1', ingredient_id: 'egg', required_quantity: 3, ingredient: { id: 'egg', name: '卵', unit: '個' } }],
      },
    ],
  }),
}))

function renderEdit() {
  render(
    <MemoryRouter initialEntries={['/recipes/r1/edit']}>
      <Routes>
        <Route path="/recipes/:id/edit" element={<RecipeEdit groupId="g1" />} />
        <Route path="/recipes/:id" element={<p>詳細画面</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('レシピのカスタマイズ', () => {
  it('保存済みの内容が入っていて、分量・名前・メモを変えて保存できる', async () => {
    vi.mocked(updateRecipe).mockResolvedValue({ recipeId: 'r1' })
    renderEdit()
    expect(screen.getByLabelText('料理名')).toHaveValue('だし巻き卵')
    expect(screen.getByLabelText('卵の分量')).toHaveValue(3)
    expect(screen.getByLabelText('作り方')).toHaveValue('溶く')
    await userEvent.clear(screen.getByLabelText('料理名'))
    await userEvent.type(screen.getByLabelText('料理名'), '甘いだし巻き卵')
    await userEvent.clear(screen.getByLabelText('卵の分量'))
    await userEvent.type(screen.getByLabelText('卵の分量'), '4')
    await userEvent.type(screen.getByLabelText('わが家のメモ'), '砂糖多め')
    await userEvent.click(screen.getByRole('button', { name: '保存する' }))
    expect(updateRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeId: 'r1',
        title: '甘いだし巻き卵',
        extras: { icon: null, servings: 2, instructions: '溶く', memo: '砂糖多め' },
        items: [expect.objectContaining({ kind: 'existing', requiredQuantity: '4', include: true })],
      })
    )
    expect(await screen.findByText('詳細画面')).toBeInTheDocument()
  })

  it('保存に失敗したら理由を出して、画面に残る', async () => {
    vi.mocked(updateRecipe).mockResolvedValue({ error: '権限がありません' })
    renderEdit()
    await userEvent.click(screen.getByRole('button', { name: '保存する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('権限がありません')
  })
})
