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
  it('参加している家を切り替え・作成・招待リンクで参加できる', async () => {
    const onSelectGroup = vi.fn()
    const onGroupsChanged = vi.fn()
    mockRpc({
      get_group_invite_status: () => ({ data: [], error: null }),
      create_group: () => ({ data: { id: 'g3', name: '実家' }, error: null }),
      join_group_with_invite: () => ({ data: { id: 'g4', name: '友人宅' }, error: null }),
    })
    const groups = [group, { id: 'g2', name: 'シェアハウス' }]
    render(
      <MemoryRouter>
        <Settings group={group} groups={groups} onSelectGroup={onSelectGroup} onGroupsChanged={onGroupsChanged} email="me@example.com" userId="u1" />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /テスト家/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('いまここ')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /シェアハウス/ }))
    expect(onSelectGroup).toHaveBeenCalledWith('g2')
    await userEvent.click(screen.getByRole('button', { name: '新しい家を建てる' }))
    await userEvent.type(screen.getByLabelText('新しい家の名前'), '実家')
    await userEvent.click(screen.getByRole('button', { name: '建てる' }))
    expect(onGroupsChanged).toHaveBeenCalledWith('g3')
    await userEvent.click(screen.getByRole('button', { name: '招待された家に入る' }))
    await userEvent.type(screen.getByLabelText('招待リンク'), `https://cookdoor.app/onboarding#invite=${'a'.repeat(43)}`)
    await userEvent.click(screen.getByRole('button', { name: '入る' }))
    expect(supabase.rpc).toHaveBeenCalledWith('join_group_with_invite', { p_token: 'a'.repeat(43) })
    expect(onGroupsChanged).toHaveBeenCalledWith('g4')
  })

  it('メンバー、アカウント、この端末だけのサインアウトがある', async () => {
    mockRpc({ get_group_invite_status: () => ({ data: [], error: null }) })
    render(<MemoryRouter><Settings group={group} email="me@example.com" userId="u1" /></MemoryRouter>)
    expect(await screen.findByText('メンバー(2人)')).toBeInTheDocument()
    expect(screen.getByText('あなた')).toBeInTheDocument()
    expect(screen.getByText('m***@ex***.com')).toBeInTheDocument()
    expect(screen.queryByText('me@example.com')).not.toBeInTheDocument()
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
