// POST /api/contact-notify — 未通知のお問い合わせを運営者に通知する(サーバー側だけで動く)。
// お問い合わせの送信後にアプリが呼ぶ。管理画面の「今すぐ通知」からも呼ぶ。ログイン中の利用者だけが呼べる。
//
// 必要な環境変数(Vercel の Production だけに設定する。VITE_ を付けないので、アプリの配信物には含まれない)
//   SUPABASE_SERVICE_ROLE_KEY            未通知の取り出しと結果の記録に使う(service_role 専用の関数だけを呼ぶ)
//   通知先はどちらか一方:
//   CONTACT_NOTIFY_WEBHOOK_URL           Slack / Discord の Incoming Webhook の URL
//   RESEND_API_KEY, CONTACT_NOTIFY_EMAIL_TO, CONTACT_NOTIFY_EMAIL_FROM   Resend でメールを送る場合
// 設定がない場合は何もしない(お問い合わせは DB に保存済みで、管理画面に「未通知」と出る)。

const CATEGORY_LABELS = { question: '使い方の質問', bug: '不具合の報告', request: '機能の要望', account: 'アカウント・データ', other: 'その他' }

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
    webhook: env.CONTACT_NOTIFY_WEBHOOK_URL,
    resendKey: env.RESEND_API_KEY,
    emailTo: env.CONTACT_NOTIFY_EMAIL_TO,
    emailFrom: env.CONTACT_NOTIFY_EMAIL_FROM,
  }
}

async function verifyUser(cfg, authorization) {
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(authorization ?? '')) return false
  try {
    const r = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: authorization }, signal: AbortSignal.timeout(5000) })
    return r.ok
  } catch {
    return false
  }
}

// 呼び出した利用者が運営者か(利用者自身の権限で is_app_admin を呼ぶ)。件数を返す相手を運営者に限るために使う
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

async function rpc(cfg, name, body) {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

export function buildMessage(contact) {
  const label = CATEGORY_LABELS[contact.contact_category] ?? contact.contact_category
  const body = String(contact.contact_body ?? '').slice(0, 300)
  return {
    subject: `COOKDOOR お問い合わせ(${label})`,
    text: `COOKDOOR にお問い合わせがありました(${label}、v${contact.contact_app_version ?? '-'})\n\n${body}\n\n管理画面: https://cookdoor.app/admin`,
  }
}

async function send(cfg, message) {
  if (cfg.webhook) {
    const r = await fetch(cfg.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Slack は text、Discord は content を読む
      body: JSON.stringify({ text: message.text, content: message.text }),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) throw new Error(`webhook ${r.status}`)
    return
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.emailFrom, to: cfg.emailTo, subject: message.subject, text: message.text }),
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`resend ${r.status}`)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
  const cfg = config()
  // Preview などでは本番の Supabase に問い合わせない(CLAUDE.md の方針)
  if (cfg.vercelEnv && cfg.vercelEnv !== 'production') return json(res, 503, { error: 'not_configured' })
  const provider = cfg.webhook || (cfg.resendKey && cfg.emailTo && cfg.emailFrom)
  if (!cfg.url || !cfg.anonKey || !cfg.serviceKey || !provider) return json(res, 503, { error: 'not_configured' })
  if (!(await verifyUser(cfg, req.headers.authorization))) return json(res, 401, { error: 'unauthorized' })

  let claimed
  try {
    claimed = (await rpc(cfg, 'claim_contact_notifications', { p_limit: 10 })) ?? []
  } catch {
    return json(res, 502, { error: 'claim_failed' })
  }

  let sent = 0
  let failed = 0
  for (const contact of claimed) {
    try {
      await send(cfg, buildMessage(contact))
      await rpc(cfg, 'mark_contact_notification', { p_id: contact.contact_id, p_ok: true, p_error: null })
      sent += 1
    } catch (e) {
      failed += 1
      try {
        await rpc(cfg, 'mark_contact_notification', { p_id: contact.contact_id, p_ok: false, p_error: String(e.message) })
      } catch {
        // 記録できなくても、10分後に再び取り出される
      }
    }
  }
  // 送信件数は運営者にだけ返す(一般の利用者には、お問い合わせの件数も分からないようにする)
  if (await isAdmin(cfg, req.headers.authorization)) return json(res, 200, { sent, failed })
  return json(res, 200, { ok: true })
}
