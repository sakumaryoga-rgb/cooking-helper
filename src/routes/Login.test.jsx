import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from './Login'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { auth: { signInWithOtp: vi.fn(), verifyOtp: vi.fn() } } }))

describe('ログイン', () => {
  beforeEach(() => {
    localStorage.clear()
    supabase.auth.signInWithOtp.mockResolvedValue({ error: null })
    supabase.auth.verifyOtp.mockResolvedValue({ error: null })
  })

  it('メールのリンクに加えて、6桁のコードでもこの画面のままログインできる', async () => {
    render(<Login />)
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'ログインリンクを送る' }))
    await userEvent.type(screen.getByLabelText(/コード/), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '123456', type: 'email' })
  })

  it('コードは6〜10桁を受け付ける(Supabase の桁数の設定に合わせる)', async () => {
    render(<Login />)
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'ログインリンクを送る' }))
    const input = screen.getByLabelText(/コード/)
    await userEvent.type(input, '12345')
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeDisabled()
    await userEvent.type(input, '678abc')
    expect(input).toHaveValue('12345678')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '12345678', type: 'email' })
  })

  it('自分でサインアウトしていないのにログインが切れた場合は知らせる', () => {
    localStorage.setItem('cookdoor.sessionExpired', '1')
    render(<Login />)
    expect(screen.getByText('ログインの有効期限が切れました。もう一度ログインしてください')).toBeInTheDocument()
  })

  it('ブラウザとホーム画面のアプリは別々にログインが必要なことを伝える', () => {
    render(<Login />)
    expect(screen.getByText(/それぞれ別にログインが必要です/)).toBeInTheDocument()
  })
})

describe('ログインし直すとき(この端末で覚えた家とメールアドレス)', () => {
  const g1 = '00000000-0000-4000-8000-000000000001'
  const g2 = '00000000-0000-4000-8000-000000000002'
  beforeEach(() => {
    localStorage.clear()
    supabase.auth.signInWithOtp.mockResolvedValue({ error: null })
  })

  it('前に使った家とメールアドレスを出し、どの家に入るかを一目で出す。タップで入る家を変えられる', async () => {
    localStorage.setItem('cookdoor.loginMemory', JSON.stringify({ email: 'me@example.com', houses: [{ id: g1, name: '山田家' }, { id: g2, name: '実家' }] }))
    localStorage.setItem('cookdoor.activeGroupId', g1)
    render(<Login />)
    expect(screen.getByText('ログインすると「山田家」に入ります')).toBeInTheDocument()
    expect(screen.getByLabelText('メールアドレス')).toHaveValue('me@example.com')
    await userEvent.click(screen.getByRole('button', { name: /実家/ }))
    expect(screen.getByText('ログインすると「実家」に入ります')).toBeInTheDocument()
    expect(localStorage.getItem('cookdoor.activeGroupId')).toBe(g2)
  })

  it('ログインリンクを送ったメールアドレスを覚える', async () => {
    render(<Login />)
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'new@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'ログインリンクを送る' }))
    expect(JSON.parse(localStorage.getItem('cookdoor.loginMemory')).email).toBe('new@example.com')
  })

  it('「別のメールアドレスでログインする」で、覚えた家とメールアドレスを消す', async () => {
    localStorage.setItem('cookdoor.loginMemory', JSON.stringify({ email: 'me@example.com', houses: [{ id: g1, name: '山田家' }] }))
    render(<Login />)
    await userEvent.click(screen.getByRole('button', { name: '別のメールアドレスでログインする' }))
    expect(screen.getByLabelText('メールアドレス')).toHaveValue('')
    expect(screen.queryByText(/山田家/)).not.toBeInTheDocument()
    expect(localStorage.getItem('cookdoor.loginMemory')).toBeNull()
  })
})
