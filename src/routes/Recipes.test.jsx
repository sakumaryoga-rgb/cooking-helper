import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Recipes } from './Recipes'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'

vi.mock('@/hooks/useIngredients', () => ({ useIngredients: vi.fn() }))
vi.mock('@/hooks/useRecipes', () => ({ useRecipes: vi.fn() }))

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
    // あと少し(不足1〜2品)のレシピには、足りない材料と数量を添える
    expect(links.map((a) => a.textContent)).toEqual(['卵焼き作れます', 'カレーpotato あと2個、carrot あと1個あと2品'])
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
