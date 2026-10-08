import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GroupSettings } from './GroupSettings'
import { TELEMETRY_NOTICE } from '@/lib/telemetry/notice'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_x'
const group = { id: 'g1', name: 'テスト家' }

function mockRpc(handlers) {
  supabase.rpc.mockImplementation((name) => Promise.resolve(handlers[name]?.() ?? { data: null, error: null }))
}

describe('グループ画面', () => {
  beforeEach(() => supabase.rpc.mockReset())

  it('利用状況とエラーの記録について説明する', async () => {
    mockRpc({ get_group_invite_status: () => ({ data: [], error: null }) })
    render(<GroupSettings group={group} />)
    expect(screen.getByText(TELEMETRY_NOTICE)).toBeInTheDocument()
    expect(await screen.findByText('有効な招待リンクはありません')).toBeInTheDocument()
  })

  it('発行した招待リンクはその場でだけ表示し、旧コードは表示しない', async () => {
    mockRpc({
      get_group_invite_status: () => ({ data: [], error: null }),
      create_group_invite: () => ({ data: [{ invite_token: TOKEN, invite_expires_at: '2026-10-15T12:00:00Z' }], error: null }),
    })
    render(<GroupSettings group={{ ...group, invite_code: 'ABCD1234' }} />)
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
    render(<GroupSettings group={group} />)
    await userEvent.click(await screen.findByRole('button', { name: '招待リンクを無効にする' }))
    await waitFor(() => expect(screen.getByText('有効な招待リンクはありません')).toBeInTheDocument())
    expect(supabase.rpc).toHaveBeenCalledWith('revoke_group_invite')
  })
})
