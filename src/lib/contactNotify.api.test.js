import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { buildMessage } from '../../api/contact-notify.js'

function call(headers = { authorization: 'Bearer user.token.x' }) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
  return handler({ method: 'POST', headers }, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body) }))
}

const contacts = [
  { contact_id: 'c1aaaaaa-0000-4000-8000-000000000001', contact_created_at: '2026-10-09T03:00:00Z', contact_category: 'bug' },
  { contact_id: 'c2bbbbbb-0000-4000-8000-000000000002', contact_created_at: '2026-10-09T03:05:00Z', contact_category: 'question' },
]
const own = [{ contact_id: 'c3cccccc-0000-4000-8000-000000000003', contact_created_at: '2026-10-09T03:10:00Z', contact_category: 'other' }]
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
      if (u.endsWith('/auth/v1/user')) {
        const ids = { 'Bearer user.token.x': 'user-1', 'Bearer admin.token.x': 'admin-1' }
        const id = ids[init.headers.Authorization]
        return id ? new Response(JSON.stringify({ id })) : new Response('{}', { status: 401 })
      }
      if (u.endsWith('/rpc/is_app_admin')) return new Response(JSON.stringify(init.headers.Authorization === 'Bearer admin.token.x'))

      if (u.endsWith('/rpc/claim_contact_notifications')) return new Response(JSON.stringify(contacts))
      if (u.endsWith('/rpc/claim_own_contact_notifications')) return new Response(JSON.stringify(JSON.parse(init.body).p_user_id === 'user-1' ? own : []))
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
  it('一般の利用者は、本人の直近のお問い合わせだけを通知でき、件数は返らない', async () => {
    expect(await call()).toEqual({ status: 200, json: { ok: true } })
    const claims = fetch.mock.calls.filter(([u]) => String(u).includes('/rpc/claim_'))
    expect(claims.map(([u, i]) => [String(u).split('/rpc/')[1], JSON.parse(i.body)])).toEqual([['claim_own_contact_notifications', { p_user_id: 'user-1' }]])
    expect(marks()).toEqual([{ p_id: own[0].contact_id, p_ok: true, p_error: null }])
  })

  it('運営者は未通知の全件を通知でき、service_role の鍵は Supabase にだけ送る', async () => {
    expect(await call({ authorization: 'Bearer admin.token.x' })).toEqual({ status: 200, json: { sent: 2, failed: 0 } })
    expect(marks()).toEqual([
      { p_id: contacts[0].contact_id, p_ok: true, p_error: null },
      { p_id: contacts[1].contact_id, p_ok: true, p_error: null },
    ])
    const webhookCalls = fetch.mock.calls.filter(([u]) => u === 'https://hooks.example/abc')
    expect(JSON.stringify(webhookCalls)).not.toContain('service-secret')
  })

  it('送信に失敗したら理由を記録する(お問い合わせは保存済み)', async () => {
    webhookStatus = 500
    expect((await call({ authorization: 'Bearer admin.token.x' })).json).toEqual({ sent: 0, failed: 2 })
    expect(marks()[0]).toEqual({ p_id: contacts[0].contact_id, p_ok: false, p_error: 'webhook 500' })
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

  it('通知の文面は受付番号・種類・受付日時だけで、本文や返信先は入らない', async () => {
    const m = buildMessage({ contact_id: 'c1aaaaaa-0000-4000-8000-000000000001', contact_created_at: '2026-10-09T03:00:00Z', contact_category: 'bug', contact_body: '秘密の本文 u@example.com' })
    expect(m.subject).toBe('COOKDOOR お問い合わせ(不具合の報告)')
    expect(m.text).toContain('受付番号: c1aaaaaa')
    expect(m.text).toContain('種類: 不具合の報告')
    expect(m.text).toContain('受付日時: 2026/10/9 12:00:00')
    expect(m.text).not.toContain('秘密の本文')
    expect(m.text).not.toContain('@')
    // Webhook に実際に送る内容も同じ
    await call()
    const sentBody = fetch.mock.calls.find(([u]) => u === 'https://hooks.example/abc')[1].body
    expect(sentBody).not.toMatch(/本文|@example/)
  })
})
