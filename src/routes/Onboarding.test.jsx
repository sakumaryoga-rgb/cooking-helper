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

  it('開いた招待リンクのトークンで参加する', async () => {
    localStorage.setItem('pendingInviteToken', TOKEN)
    supabase.rpc.mockResolvedValue({ data: { id: 'g1', name: 'A家' }, error: null })
    const changed = renderOnboarding()
    await userEvent.click(screen.getByRole('button', { name: 'グループに参加' }))
    expect(supabase.rpc).toHaveBeenCalledWith('join_group_with_invite', { p_token: TOKEN })
    expect(changed).toHaveBeenCalled()
  })

  it('無効・期限切れのリンクは案内を出す', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null })
    renderOnboarding()
    await userEvent.click(screen.getByRole('button', { name: '招待リンクで参加' }))
    await userEvent.type(screen.getByLabelText('招待リンク'), `https://cookdoor.app/onboarding#invite=${TOKEN}`)
    await userEvent.click(screen.getByRole('button', { name: 'グループに参加' }))
    expect(await screen.findByText(/招待リンクが無効か、期限が切れています/)).toBeInTheDocument()
  })

  it('旧方式の8文字コードは送らずに案内する', async () => {
    renderOnboarding()
    await userEvent.click(screen.getByRole('button', { name: '招待リンクで参加' }))
    await userEvent.type(screen.getByLabelText('招待リンク'), 'ABCD1234')
    await userEvent.click(screen.getByRole('button', { name: 'グループに参加' }))
    expect(await screen.findByText('招待リンクをそのまま貼り付けてください')).toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
