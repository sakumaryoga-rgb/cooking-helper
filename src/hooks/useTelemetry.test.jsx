import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { StrictMode, useEffect } from 'react'
import { supabase } from '@/supabaseClient'
import { useTelemetry, PAGE_VIEW_SETTLE_MS } from './useTelemetry'
import { __resetTelemetryForTests } from '@/lib/telemetry/telemetry'

vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn() } }))

const insert = vi.fn()
let navigateTo = null

function Probe({ userId = 'u1', groupId = 'g1', ready = true }) {
  useTelemetry({ userId, groupId, ready })
  const navigate = useNavigate()
  useEffect(() => {
    navigateTo = navigate
  }, [navigate])
  return null
}

function renderAt(path, props) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Probe {...props} />
        <Routes>
          <Route path="/" element={<Navigate to="/fridge" replace />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </StrictMode>
  )
}

const paths = () => insert.mock.calls.map((c) => c[0].path)

beforeEach(() => {
  vi.useFakeTimers()
  __resetTelemetryForTests()
  insert.mockReset()
  insert.mockResolvedValue({ error: null })
  supabase.from.mockReset()
  supabase.from.mockReturnValue({ insert })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTelemetry', () => {
  it('StrictMode の二重実行やリダイレクトでも、落ち着いた画面を1回だけ数える', async () => {
    renderAt('/')
    await act(async () => vi.advanceTimersByTime(PAGE_VIEW_SETTLE_MS + 10))
    expect(paths()).toEqual(['/fridge'])
  })

  it('画面遷移ごとに1PV。すぐに次の画面に移った場合は最後の画面だけ', async () => {
    renderAt('/fridge')
    await act(async () => vi.advanceTimersByTime(PAGE_VIEW_SETTLE_MS + 10))
    await act(async () => navigateTo('/recipes'))
    await act(async () => vi.advanceTimersByTime(50))
    await act(async () => navigateTo('/recipes/123e4567-e89b-12d3-a456-426614174000'))
    await act(async () => vi.advanceTimersByTime(PAGE_VIEW_SETTLE_MS + 10))
    expect(paths()).toEqual(['/fridge', '/recipes/:id'])
  })

  it('グループの読み込み中や未ログインでは数えない', async () => {
    renderAt('/fridge', { ready: false })
    await act(async () => vi.advanceTimersByTime(PAGE_VIEW_SETTLE_MS + 10))
    renderAt('/group', { userId: null })
    await act(async () => vi.advanceTimersByTime(PAGE_VIEW_SETTLE_MS + 10))
    expect(insert).not.toHaveBeenCalled()
  })

  it('記録に失敗しても画面の操作は続けられる', async () => {
    insert.mockRejectedValue(new Error('offline'))
    renderAt('/fridge')
    await act(async () => vi.advanceTimersByTime(PAGE_VIEW_SETTLE_MS + 10))
    await act(async () => navigateTo('/group'))
    await act(async () => vi.advanceTimersByTime(PAGE_VIEW_SETTLE_MS + 10))
    expect(paths()).toEqual(['/fridge', '/group'])
  })
})
