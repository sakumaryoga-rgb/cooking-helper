import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Onboarding } from './Onboarding'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_x'

function renderOnboarding(onGroupChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <Onboarding onGroupChanged={onGroupChanged} />
    </MemoryRouter>
  )
  return onGroupChanged
}

describe('招待リンクでの参加', () => {
  beforeEach(() => {
    localStorage.clear()
    supabase.rpc.mockReset()
  })

  it('招待の自動参加に失敗した理由を出し、リンクを貼って参加し直せる(参加した家を選ぶ)', async () => {
    supabase.rpc.mockResolvedValue({ data: { id: 'g1', name: 'A家' }, error: null })
    const changed = vi.fn()
    render(
      <MemoryRouter>
        <Onboarding onGroupChanged={changed} notice={{ kind: 'error', text: '招待リンクが無効か、期限が切れています。' }} />
      </MemoryRouter>
    )
    expect(screen.getByText('招待リンクが無効か、期限が切れています。')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('招待リンク'), TOKEN)
    await userEvent.click(screen.getByRole('button', { name: /家に入る/ }))
    expect(supabase.rpc).toHaveBeenCalledWith('join_group_with_invite', { p_token: TOKEN })
    expect(changed).toHaveBeenCalledWith('g1')
  })

  it('無効・期限切れのリンクは案内を出す', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null })
    renderOnboarding()
    await userEvent.click(screen.getByRole('button', { name: /^招待で入る.*家族から/ }))
    await userEvent.type(screen.getByLabelText('招待リンク'), `https://cookdoor.app/onboarding#invite=${TOKEN}`)
    await userEvent.click(screen.getByRole('button', { name: /家に入る/ }))
    expect(await screen.findByText(/招待リンクが無効か、期限が切れています/)).toBeInTheDocument()
  })

  it('旧方式の8文字コードは送らずに案内する', async () => {
    renderOnboarding()
    await userEvent.click(screen.getByRole('button', { name: /^招待で入る.*家族から/ }))
    await userEvent.type(screen.getByLabelText('招待リンク'), 'ABCD1234')
    await userEvent.click(screen.getByRole('button', { name: /家に入る/ }))
    expect(await screen.findByText('招待リンクをそのまま貼り付けてください')).toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe('家を建てる', () => {
  beforeEach(() => {
    supabase.rpc.mockReset()
  })

  it('家の名前を入れて建てると、その家を選ぶ', async () => {
    supabase.rpc.mockResolvedValue({ data: { id: 'g9' }, error: null })
    const changed = renderOnboarding()
    expect(screen.getByRole('button', { name: /^家を建てる.*はじめて/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.type(screen.getByLabelText('家の名前'), '山田家')
    await userEvent.click(screen.getByRole('button', { name: /この名前で家を建てる/ }))
    expect(supabase.rpc).toHaveBeenCalledWith('create_group', { group_name: '山田家' })
    expect(changed).toHaveBeenCalledWith('g9')
  })
})

describe('招待の自動参加があとから失敗したとき', () => {
  it('「招待で入る」に切り替えて理由を出す(家を建てる側に残さない)', () => {
    const { rerender } = render(
      <MemoryRouter>
        <Onboarding onGroupChanged={vi.fn()} notice={null} />
      </MemoryRouter>
    )
    expect(screen.getByLabelText('家の名前')).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <Onboarding onGroupChanged={vi.fn()} notice={{ kind: 'error', text: '招待リンクが無効か、期限が切れています。' }} />
      </MemoryRouter>
    )
    expect(screen.getByLabelText('招待リンク')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^招待で入る.*家族から/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('招待リンクが無効か、期限が切れています。')).toBeInTheDocument()
  })
})
