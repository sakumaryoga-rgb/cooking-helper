import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { KitchenDataProvider } from './KitchenDataProvider'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { supabase } from '@/supabaseClient'

const handlers = []
vi.mock('@/supabaseClient', () => {
  const tables = {
    ingredients: [{ id: 'i1', name: '卵', unit: '個', quantity: 2 }],
    recipes: [{ id: 'r1', title: '卵焼き', recipe_ingredients: [] }],
  }
  const query = (t) => {
    const p = Promise.resolve({ data: tables[t] ?? [], error: null })
    const c = new Proxy({}, { get: (_, k) => (k === 'then' ? p.then.bind(p) : () => c) })
    return c
  }
  const channel = () => {
    const ch = { on: (_e, _f, cb) => (handlers.push(cb), ch), subscribe: () => ch }
    return ch
  }
  return { supabase: { from: vi.fn(query), channel: vi.fn(channel), removeChannel: vi.fn(), rpc: vi.fn() } }
})

function Screen({ label }) {
  const { ingredients, loading } = useIngredients('g1')
  const { recipes } = useRecipes('g1')
  return <p>{label}:{loading ? '読み込み中' : `${ingredients.length}/${recipes.length}`}</p>
}

describe('家のデータの共有', () => {
  beforeEach(() => {
    supabase.from.mockClear()
    handlers.length = 0
  })

  it('画面がいくつあっても、各テーブルは1回だけ読み込む', async () => {
    render(
      <KitchenDataProvider groupId="g1">
        <Screen label="A" />
        <Screen label="B" />
      </KitchenDataProvider>
    )
    expect(await screen.findByText('A:1/1')).toBeInTheDocument()
    expect(screen.getByText('B:1/1')).toBeInTheDocument()
    const tables = supabase.from.mock.calls.map(([t]) => t)
    expect(tables.filter((t) => t === 'ingredients')).toHaveLength(1)
    expect(tables.filter((t) => t === 'recipes')).toHaveLength(1)
  })

  it('リアルタイムの通知が続けて届いても、読み込み中に戻さず1回だけ読み直す', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <KitchenDataProvider groupId="g1">
        <Screen label="A" />
      </KitchenDataProvider>
    )
    await waitFor(() => expect(screen.getByText('A:1/1')).toBeInTheDocument())
    supabase.from.mockClear()
    act(() => {
      for (const cb of handlers) cb()
      for (const cb of handlers) cb()
    })
    expect(screen.getByText('A:1/1')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    const tables = supabase.from.mock.calls.map(([t]) => t)
    expect(tables.filter((t) => t === 'ingredients')).toHaveLength(1)
    expect(screen.queryByText(/読み込み中/)).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
