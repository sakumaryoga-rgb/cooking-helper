import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Home } from './Home'

const line = (id, q) => ({ id: `${id}-l`, ingredient_id: id, required_quantity: q, ingredient: { id, name: id, unit: '個' } })

vi.mock('@/hooks/useIngredients', () => ({
  useIngredients: () => ({
    ingredients: [
      { id: 'egg', name: '卵', unit: '個', quantity: 4, catalog_id: null },
      { id: 'milk', name: '牛乳', unit: 'ml', quantity: 500, catalog_id: null },
    ],
    loading: false,
  }),
}))
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({
    loading: false,
    recipes: [
      { id: 'r1', title: '卵焼き', recipe_ingredients: [line('egg', 2)] },
      { id: 'r2', title: 'カレー', recipe_ingredients: [line('potato', 2)] },
      { id: 'r3', title: 'ミルクセーキ', recipe_ingredients: [line('milk', 200), line('egg', 1)] },
    ],
  }),
}))
vi.mock('@/hooks/useIngredientCatalog', () => ({ useIngredientCatalog: () => ({ catalog: [] }) }))
vi.mock('@/hooks/useSubstitutions', () => ({ useSubstitutions: () => ({ rules: [] }) }))
vi.mock('@/hooks/useIngredientBatches', () => ({
  useIngredientBatches: () => ({
    batches: [{ id: 'b1', ingredient_id: 'milk', quantity: 500, added_on: '2026-10-01', use_by: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }],
  }),
}))

describe('ホーム', () => {
  it('作れるレシピと期限が近い食材を出し、不足のあるレシピは出さない', () => {
    render(
      <MemoryRouter>
        <Home groupId="g1" />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /卵焼き/ })).toHaveAttribute('href', '/recipes/r1')
    expect(screen.queryByText('カレー')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /牛乳.*消費期限/ })).toHaveAttribute('href', '/fridge?filter=expiring')
  })
})

describe('期限が近い食材を使い切る', () => {
  it('期限が近い牛乳を使うレシピを先頭の欄に出し、今すぐ作れるでも先に並べる', () => {
    render(
      <MemoryRouter>
        <Home groupId="g1" />
      </MemoryRouter>
    )
    const section = screen.getByRole('heading', { name: /期限が近い食材を使い切る/ }).closest('section')
    expect(section).toHaveTextContent('ミルクセーキ')
    expect(section).toHaveTextContent(/牛乳\((あと1日|本日まで)\)/)
    expect(section).not.toHaveTextContent('卵焼き')
    const makeable = screen.getByRole('heading', { name: /今すぐ作れる/ }).closest('section')
    const titles = [...makeable.querySelectorAll('a')].map((a) => a.textContent)
    expect(titles[0]).toMatch('ミルクセーキ')
  })
})
