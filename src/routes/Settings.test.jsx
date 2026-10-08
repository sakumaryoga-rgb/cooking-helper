import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Settings } from './Settings'
import { TELEMETRY_NOTICE } from '@/lib/telemetry/notice'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => {
  const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: [{ user_id: 'u1', joined_at: '2026-08-20T00:00:00Z' }, { user_id: 'u2', joined_at: '2026-08-21T00:00:00Z' }] }) }
  return { supabase: { rpc: vi.fn(), from: () => chain, auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } } }
})
vi.mock('@/hooks/useSubstitutions', () => ({ useSubstitutions: () => ({ disabledRules: [], enableRule: vi.fn() }) }))
vi.mock('@/hooks/useIngredientCatalog', () => ({ useIngredientCatalog: () => ({ catalog: [] }) }))

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_x'
const group = { id: 'g1', name: 'テスト家' }

function mockRpc(handlers) {
  supabase.rpc.mockImplementation((name) => Promise.resolve(handlers[name]?.() ?? { data: null, error: null }))
}

describe('設定画面', () => {
  it('メンバー、アカウント、この端末だけのサインアウトがある', async () => {
    mockRpc({ get_group_invite_status: () => ({ data: [], error: null }) })
    render(<MemoryRouter><Settings group={group} email="me@example.com" userId="u1" /></MemoryRouter>)
    expect(await screen.findByText('メンバー(2人)')).toBeInTheDocument()
    expect(screen.getByText('あなた')).toBeInTheDocument()
    expect(screen.getByText('me@example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'この端末でサインアウト' }))
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  beforeEach(() => supabase.rpc.mockReset())

  it('利用状況とエラーの記録について説明する', async () => {
    mockRpc({ get_group_invite_status: () => ({ data: [], error: null }) })
    render(<MemoryRouter><Settings group={group} email="me@example.com" userId="u1" /></MemoryRouter>)
    expect(screen.getByText(TELEMETRY_NOTICE)).toBeInTheDocument()
    expect(await screen.findByText('有効な招待リンクはありません')).toBeInTheDocument()
  })

  it('発行した招待リンクはその場でだけ表示し、旧コードは表示しない', async () => {
    mockRpc({
      get_group_invite_status: () => ({ data: [], error: null }),
      create_group_invite: () => ({ data: [{ invite_token: TOKEN, invite_expires_at: '2026-10-15T12:00:00Z' }], error: null }),
    })
    render(<MemoryRouter><Settings group={{ ...group, invite_code: 'ABCD1234' }} email="me@example.com" userId="u1" /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: '招待リンクを発行' }))
    expect(await screen.findByText(`${window.location.origin}/onboarding#invite=${TOKEN}`)).toBeInTheDocument()
    expect(screen.queryByText(/ABCD1234/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '招待リンクを発行し直す' })).toBeInTheDocument()
  })

  it('無効にすると表示が消える', async () => {
    mockRpc({
      get_group_invite_status: () => ({ data: [{ invite_active: true, invite_expires_at: '2026-10-15T12:00:00Z' }], error: null }),
      revoke_group_invite: () => ({ data: null, error: null }),
    })
    render(<MemoryRouter><Settings group={group} email="me@example.com" userId="u1" /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: '招待リンクを無効にする' }))
    await waitFor(() => expect(screen.getByText('有効な招待リンクはありません')).toBeInTheDocument())
    expect(supabase.rpc).toHaveBeenCalledWith('revoke_group_invite')
  })
})
