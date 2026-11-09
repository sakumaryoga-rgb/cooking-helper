// POST /api/recipe-import { url } → { title, servings, yieldText, ingredients[], url, sourceKey, site }
// 対応サイト(src/lib/recipeImport/sites.js)のレシピページだけを取得し、JSON-LD から料理名・人数・材料を返す。
// 調理手順・画像・説明文は返さない。ログイン中のユーザー(Supabase のアクセストークン)だけが使える。
import { isAllowedFetchHost, parseRecipeUrl } from '../src/lib/recipeImport/sites.js'
import { extractRecipe } from '../src/lib/recipeImport/jsonld.js'

const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 8000
const USER_AGENT = 'Mozilla/5.0 (compatible; COOKDOOR/1.3; +https://cookdoor.app)'
// 取り込みの回数の上限(1人あたり)。外部サイトへの大量のアクセスと、関数の使いすぎを防ぐ
export const RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 }

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  }
}

// 取り込みの結果を、利用者の権限(RLS: 本人の行の追加だけ)で記録する。失敗しても取り込み自体は続ける
async function recordRun(authorization, site, outcome) {
  const { url, anonKey } = supabaseConfig()
  try {
    await fetch(`${url}/rest/v1/recipe_import_runs`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: authorization, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ site, outcome }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // 記録できなくても取り込みの結果は返す
  }
}

async function verifyUser(authorization) {
  // Vercel の production 以外(Preview など)では本番の Supabase に問い合わせない(CLAUDE.md、src/lib/runtimeEnv.js と同じ方針)
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv && vercelEnv !== 'production') return { configured: false }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return { configured: false }
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(authorization ?? '')) return { configured: true, ok: false }
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization },
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return { configured: true, ok: false }
    const user = await r.json().catch(() => null)
    return { configured: true, ok: true, userId: typeof user?.id === 'string' ? user.id : null }
  } catch {
    return { configured: true, ok: false }
  }
}

// この1時間の取り込みの回数(記録は recipe_import_runs。利用者は自分の記録を読めないので、サーバー専用の鍵で数える)。
// 数えられないとき(鍵が未設定・通信の失敗)は null を返し、取り込みは止めない
export async function countRecentRuns(userId, { now = Date.now(), fetchImpl = fetch } = {}) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || !/^[0-9a-f-]{36}$/i.test(userId ?? '')) return null
  const since = new Date(now - RATE_LIMIT.windowMs).toISOString()
  try {
    const r = await fetchImpl(`${url}/rest/v1/recipe_import_runs?select=id&user_id=eq.${userId}&created_at=gte.${encodeURIComponent(since)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact', Range: '0-0' },
      signal: AbortSignal.timeout(3000),
    })
    if (!r.ok && r.status !== 206) return null
    const total = Number((r.headers.get('content-range') ?? '').split('/')[1])
    return Number.isFinite(total) ? total : null
  } catch {
    return null
  }
}

// 対応サイト以外へのリダイレクトはたどらない(SSRF 対策)
async function fetchPage(url) {
  let current = url
  for (let i = 0; i < 3; i++) {
    const r = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (r.status >= 300 && r.status < 400) {
      const next = new URL(r.headers.get('location') ?? '', current)
      if (next.protocol !== 'https:' || !isAllowedFetchHost(next.hostname)) return { error: 'redirect' }
      current = next.toString()
      continue
    }
    if (!r.ok) return { error: 'status', status: r.status }
    if (!/text\/html/i.test(r.headers.get('content-type') ?? '')) return { error: 'type' }
    const buf = await r.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) return { error: 'size' }
    return { html: new TextDecoder('utf-8').decode(buf) }
  }
  return { error: 'redirect' }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })

  const auth = await verifyUser(req.headers.authorization)
  if (!auth.configured) return json(res, 503, { error: 'not_configured' })
  if (!auth.ok) return json(res, 401, { error: 'unauthorized' })
  const recent = await countRecentRuns(auth.userId)
  if (recent != null && recent >= RATE_LIMIT.max) {
    res.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT.windowMs / 1000)))
    return json(res, 429, { error: 'rate_limited' })
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body
  const parsed = parseRecipeUrl(body?.url)
  if (!parsed) return json(res, 422, { error: 'unsupported_url' })

  let page
  try {
    page = await fetchPage(parsed.url)
  } catch {
    page = { error: 'exception' }
  }
  if (page.error) {
    await recordRun(req.headers.authorization, parsed.site.id, 'fetch_failed')
    return json(res, 502, { error: 'fetch_failed', reason: page.error })
  }

  const recipe = extractRecipe(page.html)
  if (!recipe || recipe.ingredients.length === 0) {
    await recordRun(req.headers.authorization, parsed.site.id, 'no_recipe_data')
    return json(res, 422, { error: 'no_recipe_data' })
  }
  await recordRun(req.headers.authorization, parsed.site.id, 'success')

  return json(res, 200, { ...recipe, url: parsed.url, sourceKey: parsed.sourceKey, site: parsed.site.name })
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
