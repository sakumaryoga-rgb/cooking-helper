import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { buildMessage } from '../../api/contact-notify.js'

function call(headers = { authorization: 'Bearer user.token.x' }) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
  return handler({ method: 'POST', headers }, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body) }))
}

const contacts = [
  { contact_id: 'c1', contact_category: 'bug', contact_body: '在庫が減りません', contact_app_version: '1.9.0' },
  { contact_id: 'c2', contact_category: 'question', contact_body: '使い方', contact_app_version: '1.9.0' },
]
let webhookStatus = 200

beforeEach(() => {
  webhookStatus = 200
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-secret')
  vi.stubEnv('CONTACT_NOTIFY_WEBHOOK_URL', 'https://hooks.example/abc')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const u = String(url)
      if (u.endsWith('/auth/v1/user'))
        return new Response('{}', { status: ['Bearer user.token.x', 'Bearer admin.token.x'].includes(init.headers.Authorization) ? 200 : 401 })
      if (u.endsWith('/rpc/is_app_admin')) return new Response(JSON.stringify(init.headers.Authorization === 'Bearer admin.token.x'))
      if (u.endsWith('/auth/v1/user') && init.headers.Authorization === 'Bearer admin.token.x') return new Response('{}')
      if (u.endsWith('/rpc/claim_contact_notifications')) return new Response(JSON.stringify(contacts))
      if (u.endsWith('/rpc/mark_contact_notification')) return new Response(null, { status: 204 })
      if (u === 'https://hooks.example/abc') return new Response('', { status: webhookStatus })
      return new Response('', { status: 404 })
    })
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const marks = () => fetch.mock.calls.filter(([u]) => String(u).endsWith('/rpc/mark_contact_notification')).map(([, i]) => JSON.parse(i.body))

describe('/api/contact-notify', () => {
  it('未通知を送って成功を記録する。件数は運営者にだけ返し、service_role の鍵は Supabase にだけ送る', async () => {
    expect(await call()).toEqual({ status: 200, json: { ok: true } })
    expect(marks()).toEqual([
      { p_id: 'c1', p_ok: true, p_error: null },
      { p_id: 'c2', p_ok: true, p_error: null },
    ])
    const webhookCalls = fetch.mock.calls.filter(([u]) => u === 'https://hooks.example/abc')
    expect(JSON.stringify(webhookCalls)).not.toContain('service-secret')
  })

  it('運営者には送信件数を返す', async () => {
    expect((await call({ authorization: 'Bearer admin.token.x' })).json).toEqual({ sent: 2, failed: 0 })
  })

  it('送信に失敗したら理由を記録する(お問い合わせは保存済み)', async () => {
    webhookStatus = 500
    expect((await call({ authorization: 'Bearer admin.token.x' })).json).toEqual({ sent: 0, failed: 2 })
    expect(marks()[0]).toEqual({ p_id: 'c1', p_ok: false, p_error: 'webhook 500' })
  })

  it('設定済みでも、未認証・偽のトークンでは通知を起動せず、お問い合わせを取り出しも記録もしない', async () => {
    expect((await call({})).status).toBe(401)
    expect((await call({ authorization: 'Bearer forged.token.x' })).status).toBe(401)
    expect((await call({ authorization: 'not a bearer' })).status).toBe(401)
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/rpc/'))).toBe(false)
    expect(fetch.mock.calls.some(([u]) => u === 'https://hooks.example/abc')).toBe(false)
  })

  it('設定がなければ、Preview なら何もしない', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect((await call()).status).toBe(503)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-secret')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await call()).status).toBe(503)
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/rpc/'))).toBe(false)
  })

  it('通知の文面に返信先は入らず、本文は300文字まで', () => {
    const m = buildMessage({ contact_category: 'bug', contact_body: 'x'.repeat(400), contact_app_version: '1.9.0' })
    expect(m.subject).toBe('COOKDOOR お問い合わせ(不具合の報告)')
    expect(m.text).toContain('x'.repeat(300))
    expect(m.text).not.toContain('x'.repeat(301))
  })
})
