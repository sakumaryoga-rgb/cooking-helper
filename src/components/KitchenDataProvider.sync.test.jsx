import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { KitchenDataProvider } from './KitchenDataProvider'
import { resyncOnRejoin } from '@/hooks/kitchenData'

const refresh = {
  ingredients: vi.fn(),
  recipes: vi.fn(),
  batches: vi.fn(),
  catalog: vi.fn(),
  aliases: vi.fn(),
  conversions: vi.fn(),
}
let fridge = []
let catalogRows = []
vi.mock('@/hooks/useIngredients', () => ({ useIngredientsSource: () => ({ ingredients: fridge, loading: false, refresh: refresh.ingredients }) }))
vi.mock('@/hooks/useRecipes', () => ({ useRecipesSource: () => ({ recipes: [], loading: false, refresh: refresh.recipes }) }))
vi.mock('@/hooks/useIngredientBatches', () => ({ useIngredientBatchesSource: () => ({ batches: [], refresh: refresh.batches }) }))
vi.mock('@/hooks/useIngredientCatalog', () => ({ useIngredientCatalogSource: () => ({ catalog: catalogRows, loading: false, refresh: refresh.catalog }) }))
vi.mock('@/hooks/useSubstitutions', () => ({ useSubstitutionsSource: () => ({ rules: [] }) }))
vi.mock('@/hooks/useIngredientAliases', () => ({ useIngredientAliasesSource: () => ({ aliases: [], refresh: refresh.aliases }) }))
vi.mock('@/hooks/useUnitConversions', () => ({ useUnitConversionsSource: () => ({ conversions: new Map(), refresh: refresh.conversions }) }))

describe('家族の変更を取りこぼさない(同期)', () => {
  beforeEach(() => {
    for (const f of Object.values(refresh)) f.mockClear()
    fridge = []
    catalogRows = [{ id: 'c-egg', name: '卵' }]
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T10:00:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('アプリに戻ったとき・通信が戻ったときに、冷蔵庫・レシピ・食材マスタなどをすべて読み直す(続けて起きても1回)', () => {
    render(<KitchenDataProvider groupId="g1">x</KitchenDataProvider>)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    for (const f of Object.values(refresh)) expect(f).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(3000)
      window.dispatchEvent(new Event('online'))
    })
    expect(refresh.ingredients).toHaveBeenCalledTimes(2)
    expect(refresh.catalog).toHaveBeenCalledTimes(2)
  })

  it('冷蔵庫に、読み込んだ食材マスタにない品目(家族がリストにない食材を追加した)が入ったら、食材マスタを読み直す', () => {
    fridge = [{ id: 'i1', name: '卵', catalog_id: 'c-egg' }]
    const view = render(<KitchenDataProvider groupId="g1">x</KitchenDataProvider>)
    expect(refresh.catalog).not.toHaveBeenCalled()
    fridge = [...fridge, { id: 'i2', name: '花椒', catalog_id: 'c-new' }]
    view.rerender(<KitchenDataProvider groupId="g1">x</KitchenDataProvider>)
    expect(refresh.catalog).toHaveBeenCalledTimes(1)
    // 同じ品目では何度も読み直さない(読み直しても見えない品目で繰り返さない)
    fridge = [...fridge]
    view.rerender(<KitchenDataProvider groupId="g1">x</KitchenDataProvider>)
    expect(refresh.catalog).toHaveBeenCalledTimes(1)
  })
})

describe('リアルタイムの再接続', () => {
  it('つなぎ直したとき(2回目以降の SUBSCRIBED)だけ読み直す', () => {
    const reload = vi.fn()
    const onStatus = resyncOnRejoin(reload)
    onStatus('SUBSCRIBED')
    expect(reload).not.toHaveBeenCalled()
    onStatus('CHANNEL_ERROR')
    onStatus('SUBSCRIBED')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
