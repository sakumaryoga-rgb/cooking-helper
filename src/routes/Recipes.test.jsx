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

  it('「買い足し」で絞り込み、材料名で検索できる', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    useIngredients.mockReturnValue({ ingredients: [{ id: 'egg', name: 'egg', unit: '個', quantity: 2 }] })
    useRecipes.mockReturnValue({
      loading: false,
      recipes: [
        { id: 'curry', title: 'カレー', recipe_ingredients: [line('potato', 2)] },
        { id: 'tamago', title: '卵焼き', recipe_ingredients: [line('egg', 2)] },
      ],
    })
    render(
      <MemoryRouter>
        <Recipes groupId="g1" />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('tab', { name: /買い足し/ }))
    expect(screen.getByText('カレー')).toBeInTheDocument()
    expect(screen.queryByText('卵焼き')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /すべて/ }))
    await userEvent.type(screen.getByLabelText('レシピを検索'), 'egg')
    expect(screen.getByText('卵焼き')).toBeInTheDocument()
    expect(screen.queryByText('カレー')).not.toBeInTheDocument()
  })

  it('「買い足し」は足りない品数ごとに分け、あと1品のレシピは買えば作れる食材をまとめて出す', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    useIngredients.mockReturnValue({ ingredients: [{ id: 'rice', name: 'rice', unit: '個', quantity: 5 }] })
    useRecipes.mockReturnValue({
      loading: false,
      recipes: [
        { id: 'omu', title: 'オムライス', recipe_ingredients: [line('rice', 1), line('egg', 2)] },
        { id: 'tkg', title: '卵かけご飯', recipe_ingredients: [line('rice', 1), line('egg', 1)] },
        { id: 'oya', title: '親子丼', recipe_ingredients: [line('rice', 1), line('egg', 2), line('chicken', 1)] },
        { id: 'curry', title: 'カレー', recipe_ingredients: [line('potato', 1), line('carrot', 1), line('onion', 1)] },
      ],
    })
    render(
      <MemoryRouter>
        <Recipes groupId="g1" />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('tab', { name: /買い足し/ }))
    const one = screen.getByRole('region', { name: 'あと1品で作れる' })
    expect(one).toHaveTextContent('オムライス')
    expect(one).toHaveTextContent('卵かけご飯')
    expect(one).toHaveTextContent('買えば作れる: egg(2品)')
    expect(screen.getByRole('region', { name: 'あと2品で作れる' })).toHaveTextContent('親子丼')
    expect(screen.getByRole('region', { name: 'あと3品以上' })).toHaveTextContent('カレー')
    const order = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent.replace(/\d+$/, ''))
    expect(order).toEqual(['あと1品で作れる', 'あと2品で作れる', 'あと3品以上'])
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

  it('すべてのカテゴリでは、カテゴリごとにまとめ、件数を出す。カテゴリで絞り込め、検索はカテゴリをまたぐ', async () => {
    useIngredients.mockReturnValue({ ingredients: [{ id: 'egg', name: 'egg', unit: '個', quantity: 2 }] })
    useRecipes.mockReturnValue({
      loading: false,
      recipes: [
        { id: 'mabo', title: '麻婆豆腐', recipe_ingredients: [line('tofu', 1)] },
        { id: 'tamago', title: '卵焼き', recipe_ingredients: [line('egg', 2)] },
        { id: 'oyako', title: '親子丼', recipe_ingredients: [line('chicken', 1), line('egg', 2)] },
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
    // カテゴリの中は「作れる」の順(卵焼き → 親子丼)
    expect(within(sections[0]).getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('卵焼き'), expect.stringContaining('親子丼')])
    const genreTabs = within(screen.getByRole('tablist', { name: '料理のカテゴリ' }))
    expect(genreTabs.getByRole('tab', { name: /和食 2/ })).toBeInTheDocument()
    expect(genreTabs.getByRole('tab', { name: /全カテゴリ 4/ })).toBeInTheDocument()
    // 0件のカテゴリは出さない
    expect(genreTabs.queryByRole('tab', { name: /韓国料理/ })).not.toBeInTheDocument()

    await userEvent.click(genreTabs.getByRole('tab', { name: /中華 1/ }))
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/recipes/') && !a.getAttribute('href').endsWith('/new'))).toHaveLength(1)

    // 検索はカテゴリをまたぐ(すべてのカテゴリに戻すと、ほかのカテゴリの一致も出る)
    await userEvent.click(genreTabs.getByRole('tab', { name: /全カテゴリ/ }))
    await userEvent.type(screen.getByLabelText('レシピを検索'), 'egg')
    const found = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/recipes/') && !a.getAttribute('href').endsWith('/new'))
    expect(found.map((a) => a.getAttribute('href'))).toEqual(['/recipes/tamago', '/recipes/oyako'])
  })
})
