import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '@/supabaseClient'
import {
  __resetTelemetryForTests,
  ERROR_THROTTLE_MS,
  installErrorListeners,
  MAX_ERRORS_PER_PAGE,
  recordError,
  recordPageView,
  setTelemetryContext,
} from './telemetry'
import { APP_VERSION } from '@/lib/appVersion'

vi.mock('@/supabaseClient', () => ({ supabase: { from: vi.fn() } }))

const insert = vi.fn()

beforeEach(() => {
  __resetTelemetryForTests()
  insert.mockReset()
  insert.mockResolvedValue({ error: null })
  supabase.from.mockReset()
  supabase.from.mockReturnValue({ insert })
})

afterEach(() => {
  __resetTelemetryForTests()
})

describe('ページビュー', () => {
  it('未ログインでは送らない', async () => {
    setTelemetryContext({ userId: null, groupId: null })
    expect(await recordPageView('/fridge')).toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('正規化したパス、バージョン、グループを送り、user_id と日時は送らない', async () => {
    setTelemetryContext({ userId: 'u1', groupId: 'g1' })
    expect(await recordPageView('/recipes/123e4567-e89b-12d3-a456-426614174000?x=1')).toBe(true)
    expect(supabase.from).toHaveBeenCalledWith('page_views')
    expect(insert).toHaveBeenCalledWith({ path: '/recipes/:id', app_version: APP_VERSION, group_id: 'g1' })
    const row = insert.mock.calls[0][0]
    expect(row).not.toHaveProperty('user_id')
    expect(row).not.toHaveProperty('created_at')
  })

  it('同じ画面の連続した記録は1回にまとめ、別の画面に移ったら数える', async () => {
    setTelemetryContext({ userId: 'u1', groupId: 'g1' })
    await recordPageView('/fridge')
    await recordPageView('/fridge')
    await recordPageView('/fridge?tab=1')
    await recordPageView('/recipes')
    await recordPageView('/fridge')
    expect(insert.mock.calls.map((c) => c[0].path)).toEqual(['/fridge', '/recipes', '/fridge'])
  })

  it('送信に失敗しても例外を外に出さない', async () => {
    setTelemetryContext({ userId: 'u1', groupId: 'g1' })
    insert.mockRejectedValueOnce(new Error('network down'))
    await expect(recordPageView('/fridge')).resolves.toBe(false)
    insert.mockResolvedValueOnce({ error: { message: 'permission denied' } })
    await expect(recordPageView('/recipes')).resolves.toBe(false)
    supabase.from.mockImplementationOnce(() => {
      throw new Error('sync failure')
    })
    await expect(recordPageView('/group')).resolves.toBe(false)
  })
})

describe('エラー', () => {
  beforeEach(() => setTelemetryContext({ userId: 'u1', groupId: 'g1' }))

  it('伏せ字にしたメッセージとスタック、画面、指紋を送る', async () => {
    await recordError({
      kind: 'error',
      message: 'TypeError: failed for taro@example.com',
      stack: 'TypeError\n    at f (https://cookdoor.app/assets/index-a.js:1:2)',
      pathname: '/recipes/123e4567-e89b-12d3-a456-426614174000',
    })
    expect(supabase.from).toHaveBeenCalledWith('client_errors')
    const row = insert.mock.calls[0][0]
    expect(row).toMatchObject({
      kind: 'error',
      message: 'TypeError: failed for [email]',
      path: '/recipes/:id',
      app_version: APP_VERSION,
      group_id: 'g1',
    })
    expect(row.stack).toContain('/assets/index-a.js:1:2')
    expect(row.fingerprint).toMatch(/^[0-9a-f]{8}$/)
    expect(row).not.toHaveProperty('user_id')
  })

  it('同じエラーは1分に1回まで送る', async () => {
    const e = { kind: 'error', message: 'boom', stack: null, pathname: '/fridge' }
    await recordError({ ...e, now: 0 })
    await recordError({ ...e, now: 1000 })
    await recordError({ ...e, now: ERROR_THROTTLE_MS - 1 })
    await recordError({ ...e, now: ERROR_THROTTLE_MS + 1 })
    await recordError({ ...e, message: 'other', now: 2000 })
    expect(insert).toHaveBeenCalledTimes(3)
  })

  it('1回の表示で送るエラーは上限まで', async () => {
    for (let i = 0; i < MAX_ERRORS_PER_PAGE + 5; i++) {
      await recordError({ kind: 'error', message: `e${i}`, pathname: '/fridge', now: i })
    }
    expect(insert).toHaveBeenCalledTimes(MAX_ERRORS_PER_PAGE)
  })

  it('拡張機能のエラーと中身のない Script error は送らない', async () => {
    await recordError({ kind: 'error', message: 'x', source: 'chrome-extension://abc/content.js' })
    await recordError({ kind: 'error', message: 'Script error.' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('window の error と unhandledrejection を拾い、外したら拾わない', async () => {
    const target = new EventTarget()
    const uninstall = installErrorListeners(target)
    const err = new Error('render failed')
    target.dispatchEvent(Object.assign(new Event('error'), { error: err, message: err.message, filename: '' }))
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError('async failed') }))
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'plain string' }))
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(insert.mock.calls.map((c) => [c[0].kind, c[0].message])).toEqual([
      ['error', 'Error: render failed'],
      ['unhandledrejection', 'TypeError: async failed'],
      ['unhandledrejection', 'plain string'],
    ])
    uninstall()
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('after'), message: 'after' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(insert).toHaveBeenCalledTimes(3)
  })
})
