import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HouseManage } from './HouseManage'
import { supabase } from '@/supabaseClient'

let rows = []
vi.mock('@/supabaseClient', () => {
  const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: rows }) }
  return { supabase: { rpc: vi.fn(), from: () => chain } }
})

const house = { id: 'g1', name: '佐藤家' }
const OWNER = { user_id: 'u1', role: 'owner', display_name: null, joined_at: '2026-08-20T00:00:00Z' }
const MEMBER = { user_id: 'u2', role: 'member', display_name: 'はなこ', joined_at: '2026-08-21T00:00:00Z' }

function renderAs(userId, onGroupsChanged = vi.fn().mockResolvedValue()) {
  render(
    <MemoryRouter initialEntries={['/settings/houses/g1']}>
      <Routes>
        <Route path="/settings/houses/:id" element={<HouseManage groups={[house]} userId={userId} onGroupsChanged={onGroupsChanged} />} />
        <Route path="/settings" element={<p>設定画面</p>} />
      </Routes>
    </MemoryRouter>
  )
  return onGroupsChanged
}

describe('家の管理', () => {
  beforeEach(() => {
    rows = [OWNER, MEMBER]
    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('管理者には、メンバーの管理と家の削除が出る。メールアドレスは出さない', async () => {
    renderAs('u1')
    expect(await screen.findByText('2人が住んでいます')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /佐藤家/ })).toBeInTheDocument()
    expect(screen.getByText('はなこ')).toBeInTheDocument()
    expect(screen.getAllByText('管理者').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /退出させる/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /家を削除/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この家から脱退' })).toBeDisabled()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })

  it('メンバーには管理者のメニューが出ず、脱退できる(他の家は残り、一覧を読み直す)', async () => {
    const onGroupsChanged = renderAs('u2')
    expect(await screen.findByText('2人が住んでいます')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /退出させる/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /家を削除/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '家の名前を変える' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'この家から脱退' }))
    await userEvent.click(screen.getByRole('button', { name: '脱退する' }))
    expect(supabase.rpc).toHaveBeenCalledWith('leave_group', { p_group_id: 'g1' })
    await waitFor(() => expect(onGroupsChanged).toHaveBeenCalled())
    expect(await screen.findByText('設定画面')).toBeInTheDocument()
  })

  it('家の削除は、家の名前を入力するまで押せない', async () => {
    renderAs('u1')
    await userEvent.click(await screen.findByRole('button', { name: /家を削除/ }))
    const confirm = screen.getByRole('button', { name: '完全に削除する' })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText('削除する家の名前'), '佐藤')
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText('削除する家の名前'), '家')
    await userEvent.click(confirm)
    expect(supabase.rpc).toHaveBeenCalledWith('delete_group', { p_group_id: 'g1', p_confirm_name: '佐藤家' })
  })

  it('管理者を譲る・退出させるは確認してから RPC を呼び、失敗は理由を出す', async () => {
    renderAs('u1')
    await userEvent.click(await screen.findByRole('button', { name: /管理者にする/ }))
    await userEvent.click(screen.getByRole('button', { name: '管理者を譲る' }))
    expect(supabase.rpc).toHaveBeenCalledWith('transfer_group_owner', { p_group_id: 'g1', p_new_owner: 'u2' })
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: '家の管理者だけが操作できます' } })
    await userEvent.click(screen.getByRole('button', { name: /退出させる/ }))
    await userEvent.click(screen.getByRole('button', { name: '退出させる' }))
    expect(supabase.rpc).toHaveBeenCalledWith('remove_group_member', { p_group_id: 'g1', p_user_id: 'u2' })
    expect(await screen.findByRole('alert')).toHaveTextContent('家の管理者だけが操作できます')
  })

  it('脱退・削除済みの家は「見つかりません」', () => {
    render(
      <MemoryRouter initialEntries={['/settings/houses/zz']}>
        <Routes>
          <Route path="/settings/houses/:id" element={<HouseManage groups={[house]} userId="u1" />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/この家は見つかりません/)).toBeInTheDocument()
  })
})
