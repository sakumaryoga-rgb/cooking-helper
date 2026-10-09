// POST /api/contact-notify — お問い合わせを Notion のデータベースに登録する(サーバー側だけで動く)。
// BASKETBALL STATS(api/contact.js)と同じ Notion API の使い方。お問い合わせは先に Supabase に保存済み。
//
// 起動できるのは次の2つだけ(どちらも Supabase Auth でサーバーが本人を確かめる):
//   - 運営者(管理画面の「Notion に登録」・再送): 未登録の全件
//   - 一般の利用者(お問い合わせの送信後にアプリが呼ぶ): 本人が10分以内に送った未登録のものだけ
// 二重登録を防ぐため、取り出し時の印(DB)に加えて、作る前に同じ受付番号のページが Notion にないかを確かめる。
// 返信先のメールアドレスは Notion に送らない(Supabase だけで管理する)。
//
// 必要な環境変数(Vercel の Production だけに設定する。VITE_ を付けない)
//   SUPABASE_SERVICE_ROLE_KEY   未登録の取り出しと結果の記録に使う
//   NOTION_API_KEY              Notion の Internal Integration のシークレット
//   NOTION_DATABASE_ID          お問い合わせを登録するデータベースの ID
//   NOTION_ASSIGNEE_USER_ID     (任意)「担当者」に入れる Notion のユーザー ID。入れると Notion アプリに通知が届く

const NOTION_VERSION = '2022-06-28'
const CATEGORY_LABELS = { question: '使い方の質問', bug: '不具合の報告', request: '機能の要望', account: 'アカウント・データ', other: 'その他' }
const STATUS_LABELS = { open: '未対応', in_progress: '対応中', closed: '完了' }

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function config() {
  const env = process.env
  return {
    vercelEnv: env.VERCEL_ENV,
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    notionKey: env.NOTION_API_KEY,
    notionDatabaseId: env.NOTION_DATABASE_ID,
    notionAssignee: env.NOTION_ASSIGNEE_USER_ID,
  }
}

// 本人の利用者 ID(確かめられなければ null)
async function verifyUser(cfg, authorization) {
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(authorization ?? '')) return null
  try {
    const r = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: authorization }, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const user = await r.json()
    return typeof user?.id === 'string' ? user.id : null
  } catch {
    return null
  }
}

// 呼び出した利用者が運営者か(利用者自身の権限で is_app_admin を呼ぶ)
async function isAdmin(cfg, authorization) {
  try {
    const r = await fetch(`${cfg.url}/rest/v1/rpc/is_app_admin`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, Authorization: authorization, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    return r.ok && (await r.json()) === true
  } catch {
    return false
  }
}

async function supabase(cfg, path, init = {}) {
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`supabase ${path.split('?')[0]} ${r.status}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

const rpc = (cfg, name, body) => supabase(cfg, `rpc/${name}`, { method: 'POST', body: JSON.stringify(body) })

async function notion(cfg, path, body) {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.notionKey}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error(`Notion API error: ${r.status}`)
  return r.json()
}

// Notion のページの内容: 受付番号・種類・受付日時・本文・対応状況(返信先は含めない)
export function buildNotionProperties(contact, assigneeId) {
  const properties = {
    名前: { title: [{ text: { content: `お問い合わせ ${contact.id.slice(0, 8)}` } }] },
    受付番号: { rich_text: [{ text: { content: contact.id } }] },
    種別: { select: { name: CATEGORY_LABELS[contact.category] ?? 'その他' } },
    受信日時: { date: { start: new Date(contact.created_at).toISOString() } },
    内容: { rich_text: [{ text: { content: String(contact.body ?? '').slice(0, 2000) } }] },
    ステータス: { select: { name: STATUS_LABELS[contact.status] ?? '未対応' } },
  }
  if (assigneeId) properties.担当者 = { people: [{ id: assigneeId }] }
  return properties
}

// 同じ受付番号のページがあればその ID、なければ作って ID を返す(再送でページを二重に作らない)
async function upsertNotionPage(cfg, contact) {
  const found = await notion(cfg, `databases/${cfg.notionDatabaseId}/query`, {
    filter: { property: '受付番号', rich_text: { equals: contact.id } },
    page_size: 1,
  })
  if (found.results?.[0]?.id) return found.results[0].id
  const page = await notion(cfg, 'pages', {
    parent: { database_id: cfg.notionDatabaseId },
    properties: buildNotionProperties(contact, cfg.notionAssignee),
  })
  return page.id
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
  const cfg = config()
  // Preview などでは本番の Supabase に問い合わせない(CLAUDE.md の方針)
  if (cfg.vercelEnv && cfg.vercelEnv !== 'production') return json(res, 503, { error: 'not_configured' })
  if (!cfg.url || !cfg.anonKey || !cfg.serviceKey || !cfg.notionKey || !cfg.notionDatabaseId) return json(res, 503, { error: 'not_configured' })
  const userId = await verifyUser(cfg, req.headers.authorization)
  if (!userId) return json(res, 401, { error: 'unauthorized' })
  const admin = await isAdmin(cfg, req.headers.authorization)

  let claimed
  try {
    claimed =
      (admin
        ? await rpc(cfg, 'claim_contact_notifications', { p_limit: 10 })
        : await rpc(cfg, 'claim_own_contact_notifications', { p_user_id: userId })) ?? []
  } catch {
    return json(res, 502, { error: 'claim_failed' })
  }

  let sent = 0
  let failed = 0
  for (const { contact_id: id } of claimed) {
    try {
      // 本文は取り出し関数が返さないので、service_role で1件だけ読む(返信先は読まない)
      const [contact] = await supabase(cfg, `contact_messages?id=eq.${id}&select=id,created_at,category,body,status`)
      if (!contact) throw new Error('contact not found')
      const pageId = await upsertNotionPage(cfg, contact)
      await rpc(cfg, 'mark_contact_notion_sync', { p_id: id, p_page_id: pageId, p_error: null })
      sent += 1
    } catch (e) {
      failed += 1
      try {
        await rpc(cfg, 'mark_contact_notion_sync', { p_id: id, p_page_id: null, p_error: String(e.message) })
      } catch {
        // 記録できなくても、10分後に再び取り出される(Notion 側は受付番号で重複を防ぐ)
      }
    }
  }
  // 件数は運営者にだけ返す
  if (admin) return json(res, 200, { sent, failed })
  return json(res, 200, { ok: true })
}
