import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecipeItemsEditor } from './RecipeItemsEditor'
import { supabase } from '@/supabaseClient'

const eq = vi.fn()
const update = vi.fn(() => ({ eq }))
vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn(() => ({ update })) } }))
vi.mock('@/components/IngredientPicker', () => ({ IngredientPicker: () => null }))
vi.mock('@/hooks/useCommonConversions', () => ({ useCommonConversions: () => null }))
vi.mock('@/hooks/useIngredientCatalog', () => ({
  useIngredientCatalog: () => ({ catalog: [{ id: 'c-soy', name: 'しょうゆ', category: '調味料・油' }, { id: 'c-onion', name: '玉ねぎ', category: '根菜類' }] }),
}))

const soy = { id: 'i-soy', name: 'しょうゆ', unit: 'ml', quantity: 0, catalog_id: 'c-soy', is_staple: false }
const onion = { id: 'i-onion', name: '玉ねぎ', unit: '個', quantity: 1, catalog_id: 'c-onion' }
const itemOf = (ingredient) => ({ key: ingredient.id, kind: 'existing', ingredient, name: ingredient.name, unit: ingredient.unit, requiredQuantity: 1, include: true, needsCheck: false })

let latest
function Harness({ fridge }) {
  const [items, setItems] = useState(fridge.map(itemOf))
  latest = items
  return <RecipeItemsEditor groupId="g1" ingredients={fridge} items={items} setItems={setItems} emptyText="" />
}

describe('材料の「適量」(調味料だけ)', () => {
  it('調味料だけに「適量」を出す', () => {
    render(<Harness fridge={[soy, onion]} />)
    expect(screen.getAllByRole('button', { name: '適量' })).toHaveLength(1)
  })

  it('常備品なら、そのまま適量にできる(分量は空、表記は「適量」)', async () => {
    render(<Harness fridge={[{ ...soy, is_staple: true }]} />)
    await userEvent.click(screen.getByRole('button', { name: '適量' }))
    expect(latest[0]).toMatchObject({ requiredQuantity: '', amountText: '適量' })
    expect(screen.getByRole('button', { name: '適量' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    // もう一度押すと数に戻す
    await userEvent.click(screen.getByRole('button', { name: '適量' }))
    expect(latest[0]).toMatchObject({ requiredQuantity: 1, amountText: '' })
  })

  it('常備品でなければ、その場で登録するか確かめ、登録したら適量にする', async () => {
    eq.mockResolvedValueOnce({ error: null })
    render(<Harness fridge={[soy]} />)
    await userEvent.click(screen.getByRole('button', { name: '適量' }))
    expect(screen.getByRole('alertdialog', { name: '常備品に登録しますか' })).toBeInTheDocument()
    expect(latest[0].amountText).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: '常備品に登録して適量にする' }))
    expect(supabase.from).toHaveBeenCalledWith('ingredients')
    expect(update).toHaveBeenCalledWith({ is_staple: true })
    expect(eq).toHaveBeenCalledWith('id', 'i-soy')
    await waitFor(() => expect(latest[0]).toMatchObject({ requiredQuantity: '', amountText: '適量' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('「やめる」なら登録も適量もしない', async () => {
    update.mockClear()
    render(<Harness fridge={[soy]} />)
    await userEvent.click(screen.getByRole('button', { name: '適量' }))
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(update).not.toHaveBeenCalled()
    expect(latest[0]).toMatchObject({ requiredQuantity: 1 })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('この家にまだない調味料の「適量」(取り込みで初めて出てきたもの)', () => {
  let latestNew
  function NewHarness({ initial, fridge = [] }) {
    const [items, setItems] = useState(initial)
    latestNew = items
    return <RecipeItemsEditor groupId="g1" ingredients={fridge} items={items} setItems={setItems} emptyText="" />
  }
  const catalogMirin = { key: 'm', kind: 'catalog', catalogItem: { id: 'c-mirin', name: 'みりん', unit: 'ml', category: '調味料・油' }, name: 'みりん', unit: 'ml', requiredQuantity: 15, include: true, needsCheck: false }
  const newSoy = { key: 'n', kind: 'new', name: 'だし醤油', unit: 'ml', requiredQuantity: 10, include: true, needsCheck: false, needsChoice: false }

  it('食材マスタの調味料にも、新しい食材の調味料にも「適量」を出す', () => {
    render(<NewHarness initial={[catalogMirin, newSoy]} />)
    expect(screen.getAllByRole('button', { name: '適量' })).toHaveLength(2)
  })

  it('どの食材か確認待ちの材料には出さない', () => {
    render(<NewHarness initial={[{ ...newSoy, needsChoice: true, sourceName: 'だし醤油', candidates: [] }]} />)
    expect(screen.queryByRole('button', { name: '適量' })).not.toBeInTheDocument()
  })

  it('登録すると、保存のときに常備品にする印を付けて適量にする(この時点では DB を変えない)', async () => {
    update.mockClear()
    render(<NewHarness initial={[catalogMirin]} />)
    await userEvent.click(screen.getByRole('button', { name: '適量' }))
    await userEvent.click(screen.getByRole('button', { name: '常備品に登録して適量にする' }))
    expect(update).not.toHaveBeenCalled()
    expect(latestNew[0]).toMatchObject({ requiredQuantity: '', amountText: '適量', stapleOnSave: true })
    expect(screen.getByText('保存すると常備品に登録します。作ったときに在庫から引きません')).toBeInTheDocument()
    // 適量をやめたら、常備品にする印も外す
    await userEvent.click(screen.getByRole('button', { name: '適量' }))
    expect(latestNew[0]).toMatchObject({ requiredQuantity: 1, amountText: '', stapleOnSave: false })
  })

  it('冷蔵庫に同じ食材の常備品があれば、聞かずに適量にする', async () => {
    render(<NewHarness initial={[catalogMirin]} fridge={[{ id: 'i-mirin', name: 'みりん', unit: 'ml', catalog_id: 'c-mirin', is_staple: true }]} />)
    await userEvent.click(screen.getByRole('button', { name: '適量' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(latestNew[0]).toMatchObject({ amountText: '適量' })
  })

  it('冷蔵庫に常備品でない同じ食材があれば、その行を常備品にする', async () => {
    update.mockClear()
    eq.mockResolvedValueOnce({ error: null })
    render(<NewHarness initial={[catalogMirin]} fridge={[{ id: 'i-mirin', name: 'みりん', unit: 'ml', catalog_id: 'c-mirin', is_staple: false }]} />)
    await userEvent.click(screen.getByRole('button', { name: '適量' }))
    await userEvent.click(screen.getByRole('button', { name: '常備品に登録して適量にする' }))
    expect(update).toHaveBeenCalledWith({ is_staple: true })
    expect(eq).toHaveBeenCalledWith('id', 'i-mirin')
    await waitFor(() => expect(latestNew[0]).toMatchObject({ amountText: '適量' }))
  })
})
