import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { UpdatePrompt } from './UpdatePrompt'
import { __resetForTests, setBusy, setForceUpdateRequired, setNeedRefresh, setUpdateFn } from '@/lib/swUpdate'

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <UpdatePrompt />
    </MemoryRouter>
  )

describe('UpdatePrompt', () => {
  afterEach(() => __resetForTests())

  it('更新がなければ何も表示しない', () => {
    const { container } = renderAt('/fridge')
    expect(container).toBeEmptyDOMElement()
  })

  it('通常の画面では全画面の更新ダイアログを出し、「更新する」で更新を適用する', async () => {
    const update = vi.fn()
    setUpdateFn(update)
    setNeedRefresh(true)
    renderAt('/fridge')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('新しいバージョンがあります')
    await userEvent.click(screen.getByRole('button', { name: '更新する' }))
    expect(update).toHaveBeenCalledWith(true)
  })

  it('レシピ入力中はバナーに留める', () => {
    setNeedRefresh(true)
    renderAt('/recipes/new')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('入力が終わったら更新できます')
  })

  it('調理の確定中はバナーに留め、終わるとダイアログに切り替える', () => {
    setNeedRefresh(true)
    setBusy('cook-dialog', true)
    renderAt('/recipes/r1')
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => setBusy('cook-dialog', false))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('強制更新は入力中でも全画面で出す', () => {
    setForceUpdateRequired(true)
    setBusy('cook-dialog', true)
    renderAt('/recipes/new')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('重要な更新が必要です')
  })
})
