import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(links.map((a) => a.textContent)).toEqual(['卵焼き作れます', 'カレーpotato あと2個、carrot あと1個あと2品'])
  })

  it('「不足あり」で絞り込み、材料名で検索できる', async () => {
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
    await userEvent.click(screen.getByRole('tab', { name: /不足あり/ }))
    expect(screen.getByText('カレー')).toBeInTheDocument()
    expect(screen.queryByText('卵焼き')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /すべて/ }))
    await userEvent.type(screen.getByLabelText('レシピを検索'), 'egg')
    expect(screen.getByText('卵焼き')).toBeInTheDocument()
    expect(screen.queryByText('カレー')).not.toBeInTheDocument()
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
})
