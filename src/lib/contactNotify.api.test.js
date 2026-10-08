import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { buildNotionProperties } from '../../api/contact-notify.js'

function call(headers = { authorization: 'Bearer user.token.x' }) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
  return handler({ method: 'POST', headers }, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body) }))
}

const ID1 = 'c1aaaaaa-0000-4000-8000-000000000001'
const ID2 = 'c2bbbbbb-0000-4000-8000-000000000002'
const OWN = 'c3cccccc-0000-4000-8000-000000000003'
const rows = {
  [ID1]: { id: ID1, created_at: '2026-10-09T03:00:00Z', category: 'bug', body: '在庫が減りません', status: 'open' },
  [ID2]: { id: ID2, created_at: '2026-10-09T03:05:00Z', category: 'question', body: '使い方', status: 'open' },
  [OWN]: { id: OWN, created_at: '2026-10-09T03:10:00Z', category: 'other', body: '本人の問い合わせ', status: 'open' },
}
let existingPages = {}
let notionStatus = 200

beforeEach(() => {
  existingPages = {}
  notionStatus = 200
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-secret')
  vi.stubEnv('NOTION_API_KEY', 'notion-secret')
  vi.stubEnv('NOTION_DATABASE_ID', 'db123')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const u = String(url)
      const body = init.body ? JSON.parse(init.body) : null
      if (u.endsWith('/auth/v1/user')) {
        const id = { 'Bearer user.token.x': 'user-1', 'Bearer admin.token.x': 'admin-1' }[init.headers.Authorization]
        return id ? new Response(JSON.stringify({ id })) : new Response('{}', { status: 401 })
      }
      if (u.endsWith('/rpc/is_app_admin')) return new Response(JSON.stringify(init.headers.Authorization === 'Bearer admin.token.x'))
      if (u.endsWith('/rpc/claim_contact_notifications')) return new Response(JSON.stringify([{ contact_id: ID1 }, { contact_id: ID2 }]))
      if (u.endsWith('/rpc/claim_own_contact_notifications')) return new Response(JSON.stringify(body.p_user_id === 'user-1' ? [{ contact_id: OWN }] : []))
      if (u.includes('/rest/v1/contact_messages?id=eq.')) return new Response(JSON.stringify([rows[u.split('id=eq.')[1].split('&')[0]]]))
      if (u.endsWith('/rpc/mark_contact_notion_sync')) return new Response(null, { status: 204 })
      if (u === 'https://api.notion.com/v1/databases/db123/query') {
        const id = body.filter.rich_text.equals
        return new Response(JSON.stringify({ results: existingPages[id] ? [{ id: existingPages[id] }] : [] }), { status: notionStatus })
      }
      if (u === 'https://api.notion.com/v1/pages') return new Response(JSON.stringify({ id: `page-${body.properties.受付番号.rich_text[0].text.content.slice(0, 2)}` }), { status: notionStatus })
      return new Response('', { status: 404 })
    })
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const marks = () => fetch.mock.calls.filter(([u]) => String(u).endsWith('/rpc/mark_contact_notion_sync')).map(([, i]) => JSON.parse(i.body))
const pagesCreated = () => fetch.mock.calls.filter(([u]) => u === 'https://api.notion.com/v1/pages').map(([, i]) => JSON.parse(i.body))

describe('/api/contact-notify(Notion への登録)', () => {
  it('一般の利用者は本人の直近のお問い合わせだけを登録でき、件数は返らない', async () => {
    expect(await call()).toEqual({ status: 200, json: { ok: true } })
    expect(pagesCreated().map((p) => p.properties.受付番号.rich_text[0].text.content)).toEqual([OWN])
    expect(marks()).toEqual([{ p_id: OWN, p_page_id: 'page-c3', p_error: null }])
  })

  it('運営者は未登録の全件を登録でき、Notion の鍵は Notion にだけ、service_role の鍵は Supabase にだけ送る', async () => {
    expect(await call({ authorization: 'Bearer admin.token.x' })).toEqual({ status: 200, json: { sent: 2, failed: 0 } })
    for (const [u, i] of fetch.mock.calls) {
      const h = JSON.stringify(i?.headers ?? {})
      if (String(u).startsWith('https://api.notion.com')) expect(h).not.toContain('service-secret')
      else expect(h).not.toContain('notion-secret')
    }
  })

  it('同じ受付番号のページが Notion にあれば作らずに、そのページ ID を記録する(二重登録しない)', async () => {
    existingPages[ID1] = 'existing-page-1'
    await call({ authorization: 'Bearer admin.token.x' })
    expect(pagesCreated().map((p) => p.properties.受付番号.rich_text[0].text.content)).toEqual([ID2])
    expect(marks()[0]).toEqual({ p_id: ID1, p_page_id: 'existing-page-1', p_error: null })
  })

  it('Notion への登録に失敗したら理由を記録する(お問い合わせは保存済みで再送できる)', async () => {
    notionStatus = 401
    expect((await call({ authorization: 'Bearer admin.token.x' })).json).toEqual({ sent: 0, failed: 2 })
    expect(marks()[0]).toEqual({ p_id: ID1, p_page_id: null, p_error: 'Notion API error: 401' })
  })

  it('未認証・偽のトークンでは何もしない。設定がない・Preview なら何もしない', async () => {
    expect((await call({})).status).toBe(401)
    expect((await call({ authorization: 'Bearer forged.token.x' })).status).toBe(401)
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/rpc/claim') || String(u).includes('notion.com'))).toBe(false)
    vi.stubEnv('NOTION_API_KEY', '')
    expect((await call()).status).toBe(503)
    vi.stubEnv('NOTION_API_KEY', 'notion-secret')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await call()).status).toBe(503)
  })

  it('Notion のページは受付番号・種類・受付日時・本文・対応状況で、返信先は含めない', () => {
    const p = buildNotionProperties({ ...rows[ID1], reply_email: 'u@example.com' }, 'user-notion-1')
    expect(Object.keys(p).sort()).toEqual(['ステータス', '内容', '受付番号', '受信日時', '名前', '担当者', '種別'].sort())
    expect(p.種別.select.name).toBe('不具合の報告')
    expect(p.ステータス.select.name).toBe('未対応')
    expect(p.内容.rich_text[0].text.content).toBe('在庫が減りません')
    expect(JSON.stringify(p)).not.toContain('@example.com')
    expect(p.担当者).toEqual({ people: [{ id: 'user-notion-1' }] })
  })
})
