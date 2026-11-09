import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useGroup } from './useGroup'
import { supabase } from '@/supabaseClient'

const order = vi.fn()
vi.mock('@/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order }) }) }),
    auth: { refreshSession: vi.fn().mockResolvedValue({}) },
  },
}))

const session = { user: { id: 'u1' } }
const rows = (...names) => names.map((n, i) => ({ group_id: `g${i + 1}`, joined_at: '2026-01-0' + (i + 1), groups: { id: `00000000-0000-4000-8000-00000000000${i + 1}`, name: n } }))

beforeEach(() => {
  localStorage.clear()
  order.mockReset()
  supabase.auth.refreshSession.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('ログイン中の家', () => {
  it('家が1つならその家に入り、この端末に家の一覧を覚える', async () => {
    order.mockResolvedValue({ data: rows('山田家'), error: null })
    const { result } = renderHook(() => useGroup(session))
    await waitFor(() => expect(result.current.group?.name).toBe('山田家'))
    expect(result.current.needsChoice).toBe(false)
    expect(JSON.parse(localStorage.getItem('cookdoor.loginMemory')).houses).toEqual([{ id: '00000000-0000-4000-8000-000000000001', name: '山田家' }])
  })

  it('家が2つ以上で、この端末で選んだ家がないときは、どの家に入るか選んでもらう', async () => {
    order.mockResolvedValue({ data: rows('山田家', '実家'), error: null })
    const { result } = renderHook(() => useGroup(session))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.group).toBeNull()
    expect(result.current.needsChoice).toBe(true)
    act(() => result.current.selectGroup('00000000-0000-4000-8000-000000000002'))
    expect(result.current.group?.name).toBe('実家')
    expect(result.current.needsChoice).toBe(false)
  })

  it('この端末で前に選んだ家があれば、その家に入る', async () => {
    localStorage.setItem('cookdoor.activeGroupId', '00000000-0000-4000-8000-000000000002')
    order.mockResolvedValue({ data: rows('山田家', '実家'), error: null })
    const { result } = renderHook(() => useGroup(session))
    await waitFor(() => expect(result.current.group?.name).toBe('実家'))
  })

  it('ログインの期限が切れていたら、ログインを更新してもう一度だけ読む(ログイン画面に戻さない)', async () => {
    order.mockResolvedValueOnce({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }).mockResolvedValueOnce({ data: rows('山田家'), error: null })
    const { result } = renderHook(() => useGroup(session))
    await waitFor(() => expect(result.current.group?.name).toBe('山田家'))
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('サーバーにつながらなくても「家がない」にはせず、エラーを返して自動で読み直す', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    order.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } }).mockResolvedValue({ data: rows('山田家'), error: null })
    const { result } = renderHook(() => useGroup(session))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.group).toBeNull()
    expect(result.current.needsChoice).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(2100)
    })
    await waitFor(() => expect(result.current.group?.name).toBe('山田家'))
    expect(result.current.error).toBeNull()
  })

  it('一度読めた後に読み直しで失敗しても、今の家のまま', async () => {
    order.mockResolvedValueOnce({ data: rows('山田家'), error: null }).mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    const { result } = renderHook(() => useGroup(session))
    await waitFor(() => expect(result.current.group?.name).toBe('山田家'))
    await act(async () => {
      await result.current.refresh(null, { silent: true })
    })
    expect(result.current.group?.name).toBe('山田家')
  })
})
