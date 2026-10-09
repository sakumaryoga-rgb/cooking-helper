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
    await userEvent.type(screen.getByLabelText(/6桁のコード/), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '123456', type: 'email' })
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
