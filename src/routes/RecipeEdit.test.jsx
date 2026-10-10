import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RecipeEdit } from './RecipeEdit'
import { updateRecipe } from '@/lib/recipeImport/save'
import { supabase } from '@/supabaseClient'

const deleteChain = { eq: vi.fn(() => deleteChain), select: vi.fn() }
vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn(() => ({ delete: () => deleteChain })) } }))
vi.mock('@/components/IngredientPicker', () => ({ IngredientPicker: () => null }))
vi.mock('@/lib/recipeImport/save', () => ({ updateRecipe: vi.fn() }))
vi.mock('@/hooks/useIngredientCatalog', () => ({ useIngredientCatalog: () => ({ catalog: [] }) }))
vi.mock('@/hooks/useIngredientAliases', () => ({ useIngredientAliases: () => ({ aliases: [] }) }))
const fridge = [{ id: 'egg', name: '卵', unit: '個', quantity: 6 }]
vi.mock('@/hooks/useIngredients', () => ({ useIngredients: () => ({ ingredients: fridge }) }))
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({
    loading: false,
    recipes: [
      {
        id: 'o1',
        title: 'オムレツ',
        url: null,
        servings: 1,
        instructions: '卵を溶く',
        steps: [{ text: '卵を溶く', uses: [{ ingredient_id: 'egg', quantity: 2 }] }],
        memo: null,
        icon: null,
        recipe_ingredients: [{ id: 'l9', ingredient_id: 'egg', required_quantity: 2, ingredient: { id: 'egg', name: '卵', unit: '個' } }],
      },
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
        <Route path="/recipes" element={<p>レシピ一覧</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('レシピのカスタマイズ', () => {
  it('保存済みの内容が入っていて、分量・名前・メモを変えて保存できる', async () => {
    vi.mocked(updateRecipe).mockResolvedValue({ recipeId: 'r1' })
    renderEdit()
    expect(screen.getByLabelText('料理名')).toHaveValue('だし巻き卵')
    expect(screen.getByLabelText('卵の分量')).toHaveValue('3')
    // URL から取り込んだレシピは作り方を編集しない(元のページで見る)。保存済みの作り方は消さない
    expect(screen.queryByLabelText('手順1')).not.toBeInTheDocument()
    expect(screen.getByText(/作り方は元のレシピのページで見られます/)).toBeInTheDocument()
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
        steps: undefined,
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

  it('確認してからレシピを削除し、一覧に戻る', async () => {
    deleteChain.select.mockResolvedValue({ data: [{ id: 'r1' }], error: null })
    renderEdit()
    await userEvent.click(screen.getByRole('button', { name: 'このレシピを削除' }))
    expect(screen.getByText('「だし巻き卵」を削除しますか?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '削除する' }))
    expect(supabase.from).toHaveBeenCalledWith('recipes')
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'r1')
    expect(await screen.findByText('レシピ一覧')).toBeInTheDocument()
  })

  it('やめるを押したら削除しない。削除できなかったら理由を出す', async () => {
    deleteChain.select.mockResolvedValue({ data: [], error: null })
    renderEdit()
    await userEvent.click(screen.getByRole('button', { name: 'このレシピを削除' }))
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(deleteChain.select).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'このレシピを削除' }))
    await userEvent.click(screen.getByRole('button', { name: '削除する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('削除できませんでした')
  })

  it('オリジナルレシピは手順ごとの材料を編集でき、詳細から開いたときは保存で1つ前(詳細)に戻る', async () => {
    vi.mocked(updateRecipe).mockResolvedValue({ recipeId: 'r1' })
    render(
      <MemoryRouter initialEntries={['/recipes/r1', { pathname: '/recipes/o1/edit', state: { from: 'detail' } }]} initialIndex={1}>
        <Routes>
          <Route path="/recipes/:id/edit" element={<RecipeEdit groupId="g1" />} />
          <Route path="/recipes/:id" element={<p>前の画面</p>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByLabelText('手順1')).toHaveValue('卵を溶く')
    expect(screen.getByLabelText('手順1の卵の量')).toHaveValue('2')
    await userEvent.click(screen.getByRole('button', { name: '保存する' }))
    expect(updateRecipe).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipeId: 'o1', steps: [expect.objectContaining({ text: '卵を溶く', uses: [expect.objectContaining({ quantity: 2 })] })] })
    )
    expect(await screen.findByText('前の画面')).toBeInTheDocument()
  })
})
