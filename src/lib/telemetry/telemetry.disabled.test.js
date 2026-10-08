import { describe, expect, it, vi } from 'vitest'
import { supabase } from '@/supabaseClient'
import { recordError, recordPageView, setTelemetryContext } from './telemetry'

// Preview / Development のビルドと同じ状態(本番DBに接続しない)
vi.mock('@/lib/runtimeEnv', () => ({ DB_ENABLED: false, APP_ENV: 'preview' }))
vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn() } }))

describe('本番DBに接続しないビルド', () => {
  it('ログイン中でも何も送らない', async () => {
    setTelemetryContext({ userId: 'u1', groupId: 'g1' })
    expect(await recordPageView('/fridge')).toBe(false)
    expect(await recordError({ kind: 'error', message: 'x' })).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
