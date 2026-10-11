import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { CONSENT_KEY, useConsent } from './useConsent'
import { supabase } from '@/supabaseClient'
import { LEGAL_VERSIONS } from '@/lib/legal'

let rows = []
const insert = vi.fn()
vi.mock('@/supabaseClient', () => ({
  supabase: { from: vi.fn(() => ({ select: async () => ({ data: rows, error: null }), insert: (r) => insert(r) })) },
}))
const CURRENT = `${LEGAL_VERSIONS.terms}/${LEGAL_VERSIONS.privacy}`

describe('規約への同意', () => {
  beforeEach(() => {
    localStorage.clear()
    rows = []
    insert.mockReset()
    insert.mockResolvedValue({ error: null })
    supabase.from.mockClear()
  })

  it('初めて開いたとき(ログインの前)は同意を求め、同意すると端末に記録する', async () => {
    const { result } = renderHook(() => useConsent(null))
    expect(result.current.needsConsent).toBe(true)
    expect(result.current.revised).toBe(false)
    await act(() => result.current.agree())
    expect(result.current.needsConsent).toBe(false)
    expect(localStorage.getItem(CONSENT_KEY)).toBe(CURRENT)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('ログインしたら、同意の記録をサーバーにも残す(すでにある版は入れない)', async () => {
    localStorage.setItem(CONSENT_KEY, CURRENT)
    rows = [{ document: 'terms', version: LEGAL_VERSIONS.terms }]
    const { result } = renderHook(() => useConsent('u1'))
    expect(result.current.needsConsent).toBe(false)
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    expect(insert).toHaveBeenCalledWith({ document: 'privacy', version: LEGAL_VERSIONS.privacy })
  })

  it('前の版に同意していた人には「改定しました」として出し直す', () => {
    localStorage.setItem(CONSENT_KEY, 'old/old')
    const { result } = renderHook(() => useConsent('u1'))
    expect(result.current).toMatchObject({ needsConsent: true, revised: true })
  })

  it('サーバーに記録できなくても、利用は止めない', async () => {
    localStorage.setItem(CONSENT_KEY, CURRENT)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    insert.mockResolvedValue({ error: { code: '500', message: 'down' } })
    const { result } = renderHook(() => useConsent('u1'))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(result.current.needsConsent).toBe(false)
  })
})
