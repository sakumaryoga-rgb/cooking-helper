import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useConsent } from './useConsent'
import { supabase } from '@/supabaseClient'
import { LEGAL_VERSIONS } from '@/lib/legal'

let rows = []
let readError = null
const insert = vi.fn()
vi.mock('@/supabaseClient', () => ({
  supabase: { from: vi.fn(() => ({ select: async () => ({ data: rows, error: readError }), insert: (r) => insert(r) })) },
}))

const current = [
  { document: 'terms', version: LEGAL_VERSIONS.terms },
  { document: 'privacy', version: LEGAL_VERSIONS.privacy },
]

describe('規約への同意の判定', () => {
  beforeEach(() => {
    rows = []
    readError = null
    insert.mockReset()
    insert.mockResolvedValue({ error: null })
  })

  it('同意画面を有効にしていなければ、誰にも出さない(公開前)', async () => {
    const { result } = renderHook(() => useConsent('u1', { required: false }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.needsConsent).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('今の版の両方に同意していれば出さない', async () => {
    rows = current
    const { result } = renderHook(() => useConsent('u1', { required: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.needsConsent).toBe(false)
  })

  it('片方だけ・古い版だけなら出し、古い版があれば「改定」として出す', async () => {
    rows = [current[0]]
    const a = renderHook(() => useConsent('u1', { required: true }))
    await waitFor(() => expect(a.result.current.loading).toBe(false))
    expect(a.result.current).toMatchObject({ needsConsent: true, revised: true })

    rows = []
    const b = renderHook(() => useConsent('u1', { required: true }))
    await waitFor(() => expect(b.result.current.loading).toBe(false))
    expect(b.result.current).toMatchObject({ needsConsent: true, revised: false })
  })

  it('記録を読めないときは、ログインと既存データの利用を止めない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    readError = { message: 'network' }
    const { result } = renderHook(() => useConsent('u1', { required: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.needsConsent).toBe(false)
  })

  it('同意すると両方の今の版を記録する(同意済みの重複は無視)', async () => {
    insert.mockResolvedValueOnce({ error: { code: '23505' } })
    const { result } = renderHook(() => useConsent('u1', { required: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    rows = current
    let res
    await act(async () => {
      res = await result.current.agree()
    })
    expect(res).toEqual({})
    expect(insert.mock.calls.map((c) => c[0])).toEqual(current)
    expect(result.current.needsConsent).toBe(false)
  })
})
