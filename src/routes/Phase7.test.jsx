import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Contact } from './Contact'
import { Admin } from './Admin'
import { Terms, Privacy } from './Legal'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))

describe('お問い合わせ', () => {
  beforeEach(() => supabase.rpc.mockReset())

  it('内容が短い・メールアドレスが不正なら送らない', async () => {
    render(<Contact />)
    await userEvent.type(screen.getByLabelText('内容(10〜2000文字)'), '短い')
    await userEvent.click(screen.getByRole('button', { name: '送信する' }))
    expect(screen.getByText('内容は10文字以上で入力してください')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('内容(10〜2000文字)'), 'もう少し長く書きます。')
    await userEvent.type(screen.getByLabelText('返信先のメールアドレス(任意)'), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: '送信する' }))
    expect(screen.getByText('返信先のメールアドレスの形式が正しくありません')).toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('送信すると受付を伝え、制限・重複は理由を伝える', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: 'rate_limited', error: null })
    render(<Contact />)
    await userEvent.type(screen.getByLabelText('内容(10〜2000文字)'), '在庫が減らないことがあります。')
    await userEvent.click(screen.getByRole('button', { name: '送信する' }))
    expect(screen.getByText(/続けて送信されたため/)).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('submit_contact', expect.objectContaining({ p_category: 'question', p_honeypot: '', p_reply_email: null }))

    supabase.rpc.mockResolvedValueOnce({ data: 'ok', error: null })
    await userEvent.click(screen.getByRole('button', { name: '送信する' }))
    expect(screen.getByText('お問い合わせを受け付けました。返信先を入力された場合は、そのアドレスにお返事します。')).toBeInTheDocument()
  })
})

describe('管理画面', () => {
  beforeEach(() => supabase.rpc.mockReset())

  it('運営者でなければ(サーバーが forbidden を返せば)データを出さない', async () => {
    supabase.rpc.mockResolvedValue({ data: { error: 'forbidden' }, error: null })
    render(<Admin />)
    expect(await screen.findByText('この画面は運営者だけが使えます')).toBeInTheDocument()
    expect(screen.queryByText('お問い合わせ(新しい順、最大100件)')).not.toBeInTheDocument()
  })

  it('運営者には集計と問い合わせを出し、対応状況を更新できる', async () => {
    supabase.rpc.mockImplementation((name) =>
      Promise.resolve(
        name === 'admin_update_contact'
          ? { data: 'ok', error: null }
          : {
              data: {
                days: 30,
                daily: [{ day: '2026-10-08', users: 3, groups: 2, page_views: 40 }],
                monthly: [],
                versions: [{ app_version: '1.8.0', users: 3, page_views: 40 }],
                errors_daily: [],
                errors_top: [],
                imports: [{ site: 'delishkitchen', total: 4, success: 3, fetch_failed: 1, no_recipe_data: 0 }],
                imports_since: '2026-10-08T00:00:00Z',
                emails_overdue: 2,
                contacts: [{ id: 'c1', created_at: '2026-10-08T00:00:00Z', category: 'bug', body: '在庫が減りません', reply_email: 'u@example.com', status: 'open', admin_note: null, app_version: '1.8.0' }],
              },
              error: null,
            }
      )
    )
    render(<Admin />)
    expect(await screen.findByText(/成功率 75%/)).toBeInTheDocument()
    expect(screen.getByText('在庫が減りません')).toBeInTheDocument()
    expect(screen.getByText(/削除されていない返信先が 2 件/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('対応状況'), 'closed')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(supabase.rpc).toHaveBeenCalledWith('admin_update_contact', { p_id: 'c1', p_status: 'closed', p_note: '' })
  })
})

describe('規約とプライバシーポリシー(ドラフト)', () => {
  it('ドラフトと分かり、運営者情報などは推測で埋めず【未確定】のまま', () => {
    render(
      <MemoryRouter>
        <Terms />
      </MemoryRouter>
    )
    expect(screen.getByText('公開前のドラフト')).toBeInTheDocument()
    expect(screen.getAllByText(/【未確定】/).length).toBeGreaterThanOrEqual(4)
  })

  it('プライバシーポリシーは実際の収集内容(保存期間、伏せ字、外部サービス)と一致する', () => {
    render(
      <MemoryRouter>
        <Privacy />
      </MemoryRouter>
    )
    const page = screen.getByRole('article')
    expect(within(page).getByText(/品質改善のための記録: 90日/)).toBeInTheDocument()
    expect(within(page).getByText(/料理の内容や入力した文字は含みません/)).toBeInTheDocument()
    expect(within(page).getByText(/受付から90日を過ぎたら削除/)).toBeInTheDocument()
    expect(within(page).getByText(/Supabase/)).toBeInTheDocument()
  })
})
