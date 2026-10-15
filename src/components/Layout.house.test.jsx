import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './Layout'
import { useSharedKitchen } from '@/hooks/kitchenData'

// 家ごとの読み込み: 家 g1 は遅く、g2 は速く返す(g1 の結果が切り替え後に届く)
const pending = {}
vi.mock('@/components/KitchenDataProvider', async () => {
  const { useEffect, useState } = await import('react')
  const { KitchenDataContext } = await import('@/hooks/kitchenData')
  return {
    KitchenDataProvider: ({ groupId, children }) => {
      const [catalog, setCatalog] = useState({ catalog: [] })
      useEffect(() => {
        let alive = true
        new Promise((resolve) => (pending[groupId] = resolve)).then((rows) => alive && setCatalog({ catalog: rows }))
        return () => {
          alive = false
        }
      }, [groupId])
      return <KitchenDataContext.Provider value={{ groupId, catalog }}>{children}</KitchenDataContext.Provider>
    },
  }
})
vi.mock('@/components/AdSlot', () => ({ AdSlot: () => null }))
vi.mock('@/components/HouseSwitcher', () => ({ HouseBadge: () => null }))

function Names() {
  const shared = useSharedKitchen('catalog')
  return <p data-testid="names">{(shared?.catalog ?? []).map((c) => c.name).join(',')}</p>
}

function renderAt(groupId) {
  return (
    <MemoryRouter>
      <Routes>
        <Route element={<Layout groupId={groupId} groupName="家" />}>
          <Route path="/" element={<Names />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('家を切り替えた直後', () => {
  it('前の家のデータを出さず、遅れて届いた前の家の結果でも上書きしない', async () => {
    const view = render(renderAt('g1'))
    await act(async () => pending.g1([{ name: 'g1の品目' }]))
    expect(screen.getByTestId('names')).toHaveTextContent('g1の品目')

    // g2 に切り替えた直後は、g1 のデータを出さない
    view.rerender(renderAt('g2'))
    expect(screen.getByTestId('names').textContent).toBe('')
    await act(async () => pending.g2([{ name: 'g2の品目' }]))
    expect(screen.getByTestId('names')).toHaveTextContent('g2の品目')
  })
})
