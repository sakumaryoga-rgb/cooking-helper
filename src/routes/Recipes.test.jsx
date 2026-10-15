import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Recipes } from './Recipes'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'

vi.mock('@/hooks/useIngredients', () => ({ useIngredients: vi.fn() }))
vi.mock('@/hooks/useRecipes', () => ({ useRecipes: vi.fn() }))
vi.mock('@/hooks/useIngredientCatalog', () => ({ useIngredientCatalog: () => ({ catalog: [] }) }))
vi.mock('@/hooks/useSubstitutions', () => ({ useSubstitutions: () => ({ rules: [] }) }))

const line = (id, q) => ({ id: `${id}-l`, ingredient_id: id, required_quantity: q, ingredient: { id, name: id, unit: '個' } })

describe('Recipes', () => {
  it('作れるレシピを先頭に並べ、各行に判定を表示する', () => {
    useIngredients.mockReturnValue({ ingredients: [{ id: 'egg', name: 'egg', unit: '個', quantity: 2 }] })
    useRecipes.mockReturnValue({
      loading: false,
      recipes: [
        { id: 'curry', title: 'カレー', recipe_ingredients: [line('potato', 2), line('carrot', 1)] },
        { id: 'tamago', title: '卵焼き', recipe_ingredients: [line('egg', 2)] },
      ],
    })
    render(
      <MemoryRouter>
        <Recipes groupId="g1" />
      </MemoryRouter>
    )
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/recipes/') && !a.getAttribute('href').endsWith('/new'))
    // 不足のあるレシピには、足りない材料と数量をそのまま書く
    expect(links.map((a) => a.textContent.replace(/\p{Extended_Pictographic}|\uFE0F/gu, ''))).toEqual(['卵焼き作れます', 'カレーpotato あと2個、carrot あと1個あと2品'])
  })

  it('作れる・期限が近い・要確認などの絞り込みはなく、材料名で検索できる(カテゴリをまたぐ)', async () => {
    useIngredients.mockReturnValue({ ingredients: [{ id: 'egg', name: 'egg', unit: '個', quantity: 2 }] })
    useRecipes.mockReturnValue({
      loading: false,
      recipes: [
        { id: 'curry', title: 'カレー', recipe_ingredients: [line('potato', 2)] },
        { id: 'tamago', title: '卵焼き', recipe_ingredients: [line('egg', 2)] },
        { id: 'omu', title: 'オムレツ', recipe_ingredients: [line('egg', 3)] },
      ],
    })
    render(
      <MemoryRouter>
        <Recipes groupId="g1" />
      </MemoryRouter>
    )
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('レシピを検索'), 'egg')
    expect(screen.getByText('卵焼き')).toBeInTheDocument()
    expect(screen.getByText('オムレツ')).toBeInTheDocument()
    expect(screen.queryByText('カレー')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('レシピを検索'))
    await userEvent.type(screen.getByLabelText('レシピを検索'), 'ないもの')
    expect(screen.getByText(/に合うレシピはありません/)).toBeInTheDocument()
  })

  it('レシピがなければ案内を表示する', () => {
    useIngredients.mockReturnValue({ ingredients: [] })
    useRecipes.mockReturnValue({ loading: false, recipes: [] })
    render(
      <MemoryRouter>
        <Recipes groupId="g1" />
      </MemoryRouter>
    )
    expect(screen.getByText(/まだレシピがありません/)).toBeInTheDocument()
  })

  it('料理のカテゴリごとにまとめ、カテゴリの中は「作れる」の順。件数と作れる数を出す', () => {
    useIngredients.mockReturnValue({ ingredients: [{ id: 'egg', name: 'egg', unit: '個', quantity: 2 }] })
    useRecipes.mockReturnValue({
      loading: false,
      recipes: [
        { id: 'mabo', title: '麻婆豆腐', recipe_ingredients: [line('tofu', 1)] },
        { id: 'oyako', title: '親子丼', recipe_ingredients: [line('chicken', 1), line('egg', 2)] },
        { id: 'tamago', title: '卵焼き', recipe_ingredients: [line('egg', 2)] },
        // 利用者が選んだカテゴリ(料理名からの分類より優先)
        { id: 'pasta', title: '和風パスタ', category: 'italian', category_manual: true, recipe_ingredients: [line('pasta', 1)] },
      ],
    })
    render(
      <MemoryRouter>
        <Recipes groupId="g1" />
      </MemoryRouter>
    )
    const sections = screen.getAllByRole('region')
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['和食', '中華', 'イタリアン'])
    expect(within(sections[0]).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/recipes/tamago', '/recipes/oyako'])
    expect(within(sections[0]).getByRole('button', { name: /和食/ })).toHaveTextContent('2品✨ 作れる 1')
    // 和食の印はおにぎりではない
    expect(sections[0]).not.toHaveTextContent('🍙')
  })

  it('カテゴリは押すと畳め、この端末で覚える。検索中は見つかったカテゴリを開く', async () => {
    localStorage.clear()
    useIngredients.mockReturnValue({ ingredients: [{ id: 'egg', name: 'egg', unit: '個', quantity: 2 }] })
    useRecipes.mockReturnValue({
      loading: false,
      recipes: [
        { id: 'tamago', title: '卵焼き', recipe_ingredients: [line('egg', 2)] },
        { id: 'mabo', title: '麻婆豆腐', recipe_ingredients: [line('tofu', 1)] },
      ],
    })
    const view = render(
      <MemoryRouter>
        <Recipes groupId="g1" />
      </MemoryRouter>
    )
    const toggle = screen.getByRole('button', { name: /和食/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('卵焼き')).not.toBeInTheDocument()
    expect(screen.getByText('麻婆豆腐')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('cookdoor:recipeCategoriesCollapsed'))).toEqual(['japanese'])

    // 開き直しても畳んだまま
    view.unmount()
    render(
      <MemoryRouter>
        <Recipes groupId="g1" />
      </MemoryRouter>
    )
    expect(screen.queryByText('卵焼き')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('レシピを検索'), '卵')
    expect(screen.getByText('卵焼き')).toBeInTheDocument()
    localStorage.clear()
  })
})
