import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { KitchenDataProvider } from './KitchenDataProvider'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { supabase } from '@/supabaseClient'

const handlers = []
globalThis.__kitchenDb = {
  g1: { ingredients: [{ id: 'i1', name: '卵', unit: '個', quantity: 2 }], recipes: [{ id: 'r1', title: '卵焼き', recipe_ingredients: [] }] },
  g2: { ingredients: [{ id: 'j1', name: '牛乳', unit: 'ml', quantity: 500 }, { id: 'j2', name: '豆腐', unit: '丁', quantity: 1 }], recipes: [] },
}
vi.mock('@/supabaseClient', () => {
  // 家ごとのデータ(.eq('group_id', ...) の値で切り替える)
  const query = (t) => {
    let group = 'g1'
    const c = new Proxy(
      {},
      {
        get: (_, k) => {
          if (k === 'then') {
            const p = Promise.resolve({ data: globalThis.__kitchenDb[group]?.[t] ?? [], error: null })
            return p.then.bind(p)
          }
          if (k === 'eq') return (col, v) => ((col === 'group_id' || col === 'ingredients.group_id') && (group = v), c)
          return () => c
        },
      }
    )
    return c
  }
  const channel = () => {
    const ch = { on: (_e, _f, cb) => (handlers.push(cb), ch), subscribe: () => ch }
    return ch
  }
  return { supabase: { from: vi.fn(query), channel: vi.fn(channel), removeChannel: vi.fn(), rpc: vi.fn() } }
})

function Screen({ label, groupId = 'g1' }) {
  const { ingredients, loading } = useIngredients(groupId)
  const { recipes } = useRecipes(groupId)
  return (
    <p>
      {label}:{loading ? '読み込み中' : `${ingredients.length}/${recipes.length}`}:{ingredients.map((i) => `${i.name}${i.quantity}`).join(',')}
    </p>
  )
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
    expect(await screen.findByText(/^A:1\/1/)).toBeInTheDocument()
    expect(screen.getByText(/^B:1\/1/)).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText(/^A:1\/1/)).toBeInTheDocument())
    supabase.from.mockClear()
    act(() => {
      for (const cb of handlers) cb()
      for (const cb of handlers) cb()
    })
    expect(screen.getByText(/^A:1\/1/)).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    const tables = supabase.from.mock.calls.map(([t]) => t)
    expect(tables.filter((t) => t === 'ingredients')).toHaveLength(1)
    expect(screen.queryByText(/読み込み中/)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('家を切り替える(Layout が家ごとに作り直す)と、前の家のデータを出さずに新しい家を読み込む', async () => {
    const { rerender } = render(
      <KitchenDataProvider key="g1" groupId="g1">
        <Screen label="A" groupId="g1" />
      </KitchenDataProvider>
    )
    expect(await screen.findByText('A:1/1:卵2')).toBeInTheDocument()
    rerender(
      <KitchenDataProvider key="g2" groupId="g2">
        <Screen label="A" groupId="g2" />
      </KitchenDataProvider>
    )
    expect(await screen.findByText('A:2/0:牛乳500,豆腐1')).toBeInTheDocument()
    expect(screen.queryByText(/卵/)).not.toBeInTheDocument()
  })

  it('別の家を指定した画面には共有データを渡さない(自分で読み込む)', async () => {
    render(
      <KitchenDataProvider groupId="g1">
        <Screen label="X" groupId="g2" />
      </KitchenDataProvider>
    )
    expect(await screen.findByText('X:2/0:牛乳500,豆腐1')).toBeInTheDocument()
  })

  it('ほかの端末の在庫の変更(リアルタイム)が、共有している画面に反映される', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <KitchenDataProvider groupId="g1">
        <Screen label="A" />
      </KitchenDataProvider>
    )
    expect(await screen.findByText('A:1/1:卵2')).toBeInTheDocument()
    globalThis.__kitchenDb.g1.ingredients = [{ id: 'i1', name: '卵', unit: '個', quantity: 3 }]
    act(() => {
      for (const cb of handlers) cb()
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(await screen.findByText('A:1/1:卵3')).toBeInTheDocument()
    globalThis.__kitchenDb.g1.ingredients = [{ id: 'i1', name: '卵', unit: '個', quantity: 2 }]
    vi.useRealTimers()
  })
})
