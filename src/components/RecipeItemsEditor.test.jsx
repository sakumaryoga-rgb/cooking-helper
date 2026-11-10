import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecipeItemsEditor } from './RecipeItemsEditor'

const potato = { id: 'i-potato', name: 'じゃがいも', unit: '個', quantity: 3, catalog_id: 'c-potato' }
// 食材を選ぶ画面の代わりに、開いたら「じゃがいも」を選べるボタンを出す
vi.mock('@/components/IngredientPicker', () => ({
  IngredientPicker: ({ open, onSelect, onOpenChange }) =>
    open ? (
      <button type="button" onClick={() => (onSelect(potato), onOpenChange(false))}>
        じゃがいもを選ぶ
      </button>
    ) : null,
}))

let latest = []
function Harness({ initial }) {
  const [items, setItems] = useState(initial)
  latest = items
  return <RecipeItemsEditor groupId="g1" ingredients={[potato]} items={items} setItems={setItems} emptyText="なし" />
}

describe('取り込んだ材料の付け替え', () => {
  it('別の食材に変えると、取り込んだときの表記を別名として覚える', async () => {
    render(
      <Harness
        initial={[{ key: 'k1', kind: 'new', name: 'メークイン', sourceName: 'メークイン', unit: '個', requiredQuantity: 2, include: true, rawText: 'メークイン 2個' }]}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'メークインを別の食材に変える' }))
    await userEvent.click(screen.getByRole('button', { name: 'じゃがいもを選ぶ' }))
    expect(latest[0]).toMatchObject({
      kind: 'existing',
      ingredient: potato,
      name: 'じゃがいも',
      requiredQuantity: 2,
      learnAlias: { alias: 'メークイン', catalogId: 'c-potato' },
    })
    expect(screen.getByText('「メークイン」を「じゃがいも」として覚えます(次から自動で選ばれます)')).toBeInTheDocument()
  })

  it('材料の追加は、付け替えとは別に行を増やす', async () => {
    render(<Harness initial={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '材料を選択' }))
    await userEvent.click(screen.getByRole('button', { name: 'じゃがいもを選ぶ' }))
    expect(latest).toHaveLength(1)
    expect(latest[0].learnAlias).toBeUndefined()
  })

  it('迷う材料は、候補・新しい食材・ほかから選ぶ、から選んでもらう', async () => {
    const candidate = { kind: 'existing', ingredient: potato, name: 'じゃがいも', unit: '個' }
    render(
      <Harness
        initial={[
          {
            key: 'k1', kind: 'new', name: 'じゃが芋', sourceName: 'じゃが芋', unit: '個', requiredQuantity: 2, include: true,
            rawText: 'じゃが芋 2個', parsed: { name: 'じゃが芋', quantity: 2, unit: '個' }, candidates: [candidate], needsChoice: true,
          },
        ]}
      />
    )
    expect(screen.getByText(/「じゃが芋」はどの食材ですか\?/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('確認待ち 1 件(このまま保存して、あとでレシピの画面で選べます)')
    await userEvent.click(screen.getByRole('button', { name: /^じゃがいも/ }))
    expect(latest[0]).toMatchObject({ kind: 'existing', ingredient: potato, requiredQuantity: 2, needsChoice: false, learnAlias: { alias: 'じゃが芋', catalogId: 'c-potato' } })
    expect(screen.queryByText(/「じゃが芋」はどの食材ですか\?/)).not.toBeInTheDocument()
  })

  it('新しい食材として登録することも選べる', async () => {
    render(
      <Harness
        initial={[
          {
            key: 'k1', kind: 'new', name: 'じゃが芋', sourceName: 'じゃが芋', unit: '個', requiredQuantity: 2, include: true,
            parsed: { name: 'じゃが芋', quantity: 2, unit: '個' }, candidates: [{ kind: 'existing', ingredient: potato, name: 'じゃがいも', unit: '個' }], needsChoice: true,
          },
        ]}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '新しい食材「じゃが芋」' }))
    expect(latest[0]).toMatchObject({ kind: 'new', name: 'じゃが芋', needsChoice: false })
    expect(latest[0].learnAlias).toBeUndefined()
  })
})

describe('「どれか1つ」の材料', () => {
  const sato = { id: 'i-sato', name: 'さつまいも', unit: '個', quantity: 1 }
  const base = { key: 'k1', kind: 'existing', ingredient: sato, name: 'さつまいも', unit: '個', requiredQuantity: 2, include: true }

  it('「＋代わりの材料」で選んだ食材を同じ組に入れ、組を表示する。組から外すと解除する', async () => {
    render(<Harness initial={[base]} />)
    await userEvent.click(screen.getByRole('button', { name: 'さつまいもの代わりの材料を追加' }))
    await userEvent.click(screen.getByRole('button', { name: 'じゃがいもを選ぶ' }))
    expect(latest.map((i) => [i.name, i.choiceGroup, i.requiredQuantity])).toEqual([
      ['さつまいも', 1, 2],
      ['じゃがいも', 1, 2],
    ])
    expect(screen.getByText(/どれか1つ/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'じゃがいもを「どれか1つ」から外す' }))
    expect(latest.map((i) => i.choiceGroup)).toEqual([null, null])
    expect(screen.queryByText(/どれか1つ/)).not.toBeInTheDocument()
  })

  it('必須・任意は組でそろえる', async () => {
    const alt = { ...base, key: 'k2', ingredient: potato, name: 'じゃがいも', choiceGroup: 1 }
    render(<Harness initial={[{ ...base, choiceGroup: 1 }, alt]} />)
    const group = screen.getByRole('radiogroup', { name: 'じゃがいもは必須か任意か' })
    await userEvent.click(within(group).getByRole('radio', { name: '任意' }))
    expect(latest.map((i) => i.optional)).toEqual([true, true])
  })
})
