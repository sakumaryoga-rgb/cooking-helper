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
