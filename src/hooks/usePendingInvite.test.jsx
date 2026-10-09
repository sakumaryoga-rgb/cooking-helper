import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePendingInvite, INVITE_MESSAGES } from './usePendingInvite'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_x'

describe('ログイン後の招待リンクでの参加', () => {
  beforeEach(() => {
    localStorage.clear()
    supabase.rpc.mockReset()
  })

  it('ログイン前に開いた招待で、ログイン後に招待先の家に参加してその家を選ぶ', async () => {
    localStorage.setItem('pendingInviteToken', TOKEN)
    supabase.rpc.mockResolvedValue({ data: { id: 'g-invited', name: 'A家' }, error: null })
    const onJoined = vi.fn().mockResolvedValue()
    const { result, rerender } = renderHook(({ ready }) => usePendingInvite({ ready, onJoined }), { initialProps: { ready: false } })
    expect(supabase.rpc).not.toHaveBeenCalled() // ログインと家の読み込みが終わるまで待つ
    rerender({ ready: true })
    await waitFor(() => expect(result.current.notice?.kind).toBe('joined'))
    expect(supabase.rpc).toHaveBeenCalledWith('join_group_with_invite', { p_token: TOKEN })
    expect(onJoined).toHaveBeenCalledWith('g-invited')
    expect(localStorage.getItem('pendingInviteToken')).toBeNull()
  })

  it('無効・期限切れ・古い形式の招待は日本語で理由を出す', async () => {
    localStorage.setItem('pendingInviteToken', TOKEN)
    supabase.rpc.mockResolvedValue({ data: null, error: null })
    const a = renderHook(() => usePendingInvite({ ready: true, onJoined: vi.fn() }))
    await waitFor(() => expect(a.result.current.notice).toEqual({ kind: 'error', text: INVITE_MESSAGES.invalid }))

    localStorage.setItem('pendingInviteCode', '1')
    const b = renderHook(() => usePendingInvite({ ready: true, onJoined: vi.fn() }))
    await waitFor(() => expect(b.result.current.notice).toEqual({ kind: 'error', text: INVITE_MESSAGES.legacy }))
  })

  it('招待がなければ何もしない', () => {
    renderHook(() => usePendingInvite({ ready: true, onJoined: vi.fn() }))
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
