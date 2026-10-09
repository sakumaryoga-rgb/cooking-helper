import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecipeStepsEditor } from './RecipeStepsEditor'

const items = [
  { key: 'k-onion', name: '玉ねぎ', unit: '個', requiredQuantity: 1, include: true },
  { key: 'k-beef', name: '牛こま切れ肉', unit: 'g', requiredQuantity: 200, include: true },
  { key: 'k-off', name: '外した材料', unit: '個', requiredQuantity: 1, include: false },
]
let latest
function Harness() {
  const [steps, setSteps] = useState([
    { id: 's1', text: '玉ねぎを切る', uses: [] },
    { id: 's2', text: '肉と玉ねぎを炒める', uses: [] },
  ])
  latest = steps
  return <RecipeStepsEditor steps={steps} setSteps={setSteps} items={items} />
}

describe('手順ごとの材料と量', () => {
  it('手順ごとにレシピの材料を選んで量を入れられ、同じ材料を複数の手順で使える', async () => {
    render(<Harness />)
    await userEvent.selectOptions(screen.getByLabelText('手順1で使う材料を追加'), 'k-onion')
    await userEvent.type(screen.getByLabelText('手順1の玉ねぎの量'), '1')
    await userEvent.selectOptions(screen.getByLabelText('手順2で使う材料を追加'), 'k-beef')
    await userEvent.type(screen.getByLabelText('手順2の牛こま切れ肉の量'), '200')
    await userEvent.selectOptions(screen.getByLabelText('手順2で使う材料を追加'), 'k-onion')
    expect(latest[0].uses).toEqual([{ itemKey: 'k-onion', quantity: '1' }])
    expect(latest[1].uses).toEqual([{ itemKey: 'k-beef', quantity: '200' }, { itemKey: 'k-onion', quantity: '' }])
    // 外した材料は選べない
    expect(within(screen.getByLabelText('手順1で使う材料を追加')).queryByText('外した材料')).not.toBeInTheDocument()
  })

  it('手順の量の合計が材料の分量と違えば知らせる(直さない)', async () => {
    render(<Harness />)
    await userEvent.selectOptions(screen.getByLabelText('手順1で使う材料を追加'), 'k-onion')
    await userEvent.type(screen.getByLabelText('手順1の玉ねぎの量'), '1')
    await userEvent.selectOptions(screen.getByLabelText('手順2で使う材料を追加'), 'k-onion')
    await userEvent.type(screen.getByLabelText('手順2の玉ねぎの量'), '1')
    expect(screen.getByRole('note')).toHaveTextContent('玉ねぎ: 手順の合計 2個 / 材料 1個')
  })

  it('手順の並べ替え・削除で、手順の材料も一緒に動く', async () => {
    render(<Harness />)
    await userEvent.selectOptions(screen.getByLabelText('手順1で使う材料を追加'), 'k-onion')
    await userEvent.click(screen.getByRole('button', { name: '手順1を下へ' }))
    expect(latest.map((s) => s.text)).toEqual(['肉と玉ねぎを炒める', '玉ねぎを切る'])
    expect(latest[1].uses).toEqual([{ itemKey: 'k-onion', quantity: '' }])
    await userEvent.click(screen.getByRole('button', { name: '手順2を消す' }))
    expect(latest).toHaveLength(1)
  })
})
