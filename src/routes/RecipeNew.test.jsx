import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RecipeNew } from './RecipeNew'
import { fetchRecipeFromUrl } from '@/lib/recipeImport/client'
import { findDuplicate, saveRecipe } from '@/lib/recipeImport/save'

vi.mock('@/supabaseClient', () => ({ supabase: {} }))
vi.mock('@/hooks/useIngredients', () => ({ useIngredients: () => ({ ingredients: [{ id: 'i1', name: 'きゅうり', unit: '本', quantity: 2 }] }) }))
vi.mock('@/hooks/useIngredientCatalog', () => ({ useIngredientCatalog: () => ({ catalog: [{ id: 'c1', name: '鶏むね肉', unit: 'g' }] }) }))
vi.mock('@/hooks/useIngredientAliases', () => ({ useIngredientAliases: () => ({ aliases: [{ alias: '鶏胸肉', catalog_id: 'c1', group_id: null }] }) }))
vi.mock('@/components/IngredientPicker', () => ({ IngredientPicker: () => null }))
vi.mock('@/lib/recipeImport/client', () => ({ fetchRecipeFromUrl: vi.fn() }))
vi.mock('@/lib/recipeImport/save', () => ({ findDuplicate: vi.fn(), saveRecipe: vi.fn() }))

const URL_ = 'https://delishkitchen.tv/recipes/194135459369058708'

function renderPage() {
  render(
    <MemoryRouter>
      <RecipeNew groupId="g1" userId="u1" />
    </MemoryRouter>
  )
}

describe('レシピURLの取り込み', () => {
  beforeEach(() => {
    vi.mocked(findDuplicate).mockResolvedValue(null)
    vi.mocked(saveRecipe).mockResolvedValue({ recipeId: 'r1' })
    vi.mocked(fetchRecipeFromUrl).mockResolvedValue({
      recipe: { title: 'バンバンジー', servings: 2, yieldText: '2人分', url: URL_, sourceKey: 'delishkitchen:194135459369058708', site: 'DELISH KITCHEN', ingredients: ['＜タレ＞', '鶏むね肉 1枚(250g)', 'きゅうり 1本', '塩 少々'] },
    })
  })

  it('URLを貼って読み込むと、料理名と材料が入り、確認して保存できる', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(screen.getByLabelText('タイトル')).toHaveValue('バンバンジー')
    expect(screen.getByText(/3 件の材料を読み込みました/)).toBeInTheDocument()
    expect(screen.getByLabelText('鶏むね肉の分量')).toHaveValue(250)
    expect(screen.getByLabelText('塩を保存する')).not.toBeChecked()

    await userEvent.clear(screen.getByLabelText('きゅうりの分量'))
    await userEvent.type(screen.getByLabelText('きゅうりの分量'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'レシピを保存' }))
    const args = vi.mocked(saveRecipe).mock.calls[0][0]
    expect(args).toMatchObject({ title: 'バンバンジー', url: URL_, sourceKey: 'delishkitchen:194135459369058708', sourceSite: 'DELISH KITCHEN', servings: 2 })
    expect(args.items.find((i) => i.name === 'きゅうり').requiredQuantity).toBe('2')
  })

  it('すでに保存したレシピは読み込まずに知らせる', async () => {
    vi.mocked(findDuplicate).mockResolvedValue({ id: 'r9', title: 'バンバンジー' })
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    const msg = screen.getByText(/すでに保存されています/)
    expect(within(msg).getByRole('link', { name: 'バンバンジー' })).toHaveAttribute('href', '/recipes/r9')
    expect(fetchRecipeFromUrl).not.toHaveBeenCalled()
  })

  it('対応していないサイトは手動登録に案内する', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), 'https://cookpad.com/recipe/1')
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(screen.getByText(/材料を手動で追加してください/)).toBeInTheDocument()
    expect(fetchRecipeFromUrl).not.toHaveBeenCalled()
  })

  it('読み込みに失敗したら理由を出し、手動で続けられる', async () => {
    vi.mocked(fetchRecipeFromUrl).mockResolvedValue({ error: 'このページから材料を読み取れませんでした。材料は下で手動で追加してください' })
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(screen.getByText(/読み取れませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '材料を選択' })).toBeInTheDocument()
  })
})

describe('自分で考えたレシピ', () => {
  beforeEach(() => {
    vi.mocked(saveRecipe).mockReset()
    vi.mocked(saveRecipe).mockResolvedValue({ recipeId: 'r9' })
  })

  it('URLなしで、料理名・作り方・メモ・人数・絵をつけて保存できる', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: '自分で考える' }))
    expect(screen.queryByLabelText('レシピのURL')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('料理名'), 'おばあちゃんの肉じゃが')
    await userEvent.click(screen.getByRole('radio', { name: '絵 🍲' }))
    await userEvent.type(screen.getByLabelText('何人分'), '4')
    await userEvent.type(screen.getByLabelText('作り方'), '具を切る{enter}煮る')
    await userEvent.type(screen.getByLabelText('わが家のメモ'), '甘めに')
    await userEvent.click(screen.getByRole('button', { name: 'レシピを保存' }))
    expect(saveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'おばあちゃんの肉じゃが',
        url: null,
        sourceKey: null,
        extras: { icon: '🍲', servings: 4, instructions: '具を切る\n煮る', memo: '甘めに' },
      })
    )
  })
})
