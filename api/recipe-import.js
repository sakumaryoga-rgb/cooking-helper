// POST /api/recipe-import { url } → { title, servings, yieldText, ingredients[], url, sourceKey, site, method }
// 対応サイト(src/lib/recipeImport/sites.js)のレシピページと、それ以外の公開ページ(汎用の読み取り)から、
// 料理名・人数・材料だけを返す。調理手順・画像・説明文は返さない。ログイン中のユーザー(Supabase のアクセストークン)だけが使える。
// - 汎用の読み取り: robots.txt で禁止されたページは取得しない。宛先は api/_lib/safeFetch.js で確かめる(SSRF 対策)
// - 読み取れなかったときは、ドメイン・パス・理由・ページの特徴を recipe_import_failures に記録する(読み取りを直すため)
import { genericSourceKey, isAllowedFetchHost, parseImportUrl } from '../src/lib/recipeImport/sites.js'
import { extractAnyRecipe, pageFeatures, robotsAllows } from '../src/lib/recipeImport/generic.js'
import { safeFetch } from './_lib/safeFetch.js'

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
async function insertRow(authorization, table, row) {
  const { url, anonKey } = supabaseConfig()
  try {
    await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: authorization, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // 記録できなくても取り込みの結果は返す
  }
}

async function recordRun(authorization, site, outcome, method = null) {
  await insertRow(authorization, 'recipe_import_runs', method ? { site, outcome, method } : { site, outcome })
}

// 失敗の記録の行(ドメインとパスだけ。クエリ文字列は記録しない)
export function failureRow({ site, url, reason, status = null, features = {} }) {
  let host = ''
  let path = '/'
  try {
    const u = new URL(url)
    host = u.hostname.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 253)
    path = (u.pathname || '/').slice(0, 300)
  } catch {
    return null
  }
  if (!host) return null
  return { site, host, path, reason, http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null, features }
}

async function recordFailure(authorization, info) {
  const row = failureRow(info)
  if (row) await insertRow(authorization, 'recipe_import_failures', row)
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
  const parsed = parseImportUrl(body?.url)
  if (!parsed) return json(res, 422, { error: 'unsupported_url' })
  const authorization = req.headers.authorization
  if (parsed.generic) return importGeneric(res, authorization, parsed)

  let page
  try {
    page = await fetchPage(parsed.url)
  } catch {
    page = { error: 'exception' }
  }
  if (page.error) {
    await recordRun(authorization, parsed.site.id, 'fetch_failed')
    await recordFailure(authorization, { site: parsed.site.id, url: parsed.url, reason: FETCH_REASON[page.error] ?? 'fetch_error', status: page.status })
    return json(res, 502, { error: 'fetch_failed', reason: page.error })
  }

  const found = extractAnyRecipe(page.html)
  if (!found) {
    const features = pageFeatures(page.html)
    await recordRun(authorization, parsed.site.id, 'no_recipe_data')
    await recordFailure(authorization, { site: parsed.site.id, url: parsed.url, reason: noDataReason(features), status: 200, features })
    return json(res, 422, { error: 'no_recipe_data' })
  }
  await recordRun(authorization, parsed.site.id, 'success', found.method)

  return json(res, 200, { ...found.recipe, url: parsed.url, sourceKey: parsed.sourceKey, site: parsed.site.name, method: found.method })
}

// fetchPage の失敗 → 記録の理由
const FETCH_REASON = { redirect: 'fetch_redirect', status: 'fetch_status', type: 'fetch_type', size: 'fetch_size', exception: 'fetch_error' }

function noDataReason(features) {
  return features.ld_recipe_without_ingredients ? 'recipe_no_ingredients' : 'no_recipe_data'
}

// 対応サイト以外のページ: robots.txt を確かめてから、構造化データ → microdata → 材料の見出し の順に読み取る
export async function importGeneric(res, authorization, parsed, { fetcher = safeFetch } = {}) {
  const site = parsed.site.id
  const u = new URL(parsed.url)
  const robots = await fetcher(`https://${u.hostname}/robots.txt`, { accept: 'text/plain', expectType: null, maxBytes: 512 * 1024, timeoutMs: 3000, maxRedirects: 2 })
  if (robots.error === 'blocked_host') {
    await recordRun(authorization, site, 'blocked')
    await recordFailure(authorization, { site, url: parsed.url, reason: 'blocked_host' })
    return json(res, 422, { error: 'unsupported_url' })
  }
  // robots.txt がない・読めないときは禁止されていないとみなす
  if (robots.body && !robotsAllows(robots.body, `${u.pathname}${u.search}`)) {
    await recordRun(authorization, site, 'blocked')
    await recordFailure(authorization, { site, url: parsed.url, reason: 'robots_disallowed' })
    return json(res, 422, { error: 'robots_disallowed' })
  }

  const page = await fetcher(parsed.url)
  if (page.error) {
    const blocked = page.error === 'blocked_host'
    await recordRun(authorization, site, blocked ? 'blocked' : 'fetch_failed')
    await recordFailure(authorization, { site, url: parsed.url, reason: page.error, status: page.status })
    return blocked ? json(res, 422, { error: 'unsupported_url' }) : json(res, 502, { error: 'fetch_failed', reason: page.error })
  }

  const found = extractAnyRecipe(page.body)
  if (!found) {
    const features = pageFeatures(page.body)
    await recordRun(authorization, site, 'no_recipe_data')
    await recordFailure(authorization, { site, url: parsed.url, reason: noDataReason(features), status: page.status, features })
    return json(res, 422, { error: 'no_recipe_data' })
  }
  await recordRun(authorization, site, 'success', found.method)
  const sourceKey = await genericSourceKey(parsed.url)
  return json(res, 200, { ...found.recipe, url: parsed.url, sourceKey, site: parsed.site.name, method: found.method })
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
