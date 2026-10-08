// ページビューとクライアントエラーの送信。アプリ本体の操作を妨げないことを最優先にする。
// - 送信は待たない(fire-and-forget)。失敗しても例外を外に出さず、画面にも何も出さない。
// - 本番DBに接続しないビルド(Preview など)と、未ログインのときは何もしない。
// - user_id と created_at は DB の既定値で決まる(クライアントからは送らない・送れない)。
import { supabase } from '@/supabaseClient'
import { DB_ENABLED } from '@/lib/runtimeEnv'
import { APP_VERSION } from '@/lib/appVersion'
import { normalizePath } from './paths'
import { fingerprintOf, sanitizeMessage, sanitizeStack } from './sanitize'

export const ERROR_THROTTLE_MS = 60 * 1000
export const MAX_ERRORS_PER_PAGE = 20

let context = { enabled: false, groupId: null }
let lastPageViewPath = null
const lastErrorSentAt = new Map()
let errorsSent = 0

// App から、ログイン状態と所属グループが分かるたびに呼ぶ
export function setTelemetryContext({ userId, groupId }) {
  const enabled = DB_ENABLED && Boolean(userId)
  if (!enabled || userId !== context.userId) lastPageViewPath = null
  context = { enabled, userId: userId ?? null, groupId: groupId ?? null }
}

function send(table, row) {
  if (!context.enabled) return Promise.resolve(false)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false)
  // supabase-js が同期的に例外を投げた場合も含め、すべて握りつぶす
  return Promise.resolve()
    .then(() => supabase.from(table).insert({ ...row, app_version: APP_VERSION, group_id: context.groupId }))
    .then((result) => !result?.error)
    .catch(() => false)
}

// 画面遷移ごとに1回。同じ画面(正規化前のパスが同じ)への再描画・再実行は数えない
export function recordPageView(pathname) {
  if (!context.enabled) return Promise.resolve(false)
  const raw = String(pathname || '/').split(/[?#]/)[0]
  if (raw === lastPageViewPath) return Promise.resolve(false)
  lastPageViewPath = raw
  return send('page_views', { path: normalizePath(raw) })
}

const IGNORED_MESSAGES = [/^Script error\.?$/i, /ResizeObserver loop/i]
const EXTENSION_SOURCE = /^(?:chrome|moz|safari|safari-web)-extension:\/\//i

export function recordError({ kind, message, stack, source, pathname, now = Date.now() }) {
  if (!context.enabled) return Promise.resolve(false)
  if (source && EXTENSION_SOURCE.test(source)) return Promise.resolve(false)
  if (IGNORED_MESSAGES.some((re) => re.test(String(message ?? '')))) return Promise.resolve(false)
  if (errorsSent >= MAX_ERRORS_PER_PAGE) return Promise.resolve(false)

  const safeMessage = sanitizeMessage(message)
  const safeStack = sanitizeStack(stack)
  const path = normalizePath(pathname ?? globalThis.location?.pathname)
  const fingerprint = fingerprintOf(kind, safeMessage, safeStack?.split('\n')[1] ?? '')

  const last = lastErrorSentAt.get(fingerprint)
  if (last !== undefined && now - last < ERROR_THROTTLE_MS) return Promise.resolve(false)
  lastErrorSentAt.set(fingerprint, now)
  errorsSent += 1

  return send('client_errors', { kind, message: safeMessage, stack: safeStack, path, fingerprint })
}

function toMessageAndStack(value) {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack }
  if (value && typeof value === 'object' && 'message' in value) return { message: String(value.message), stack: value.stack }
  return { message: typeof value === 'string' ? value : 'Non-Error value', stack: null }
}

// window の error / unhandledrejection を購読する。既存のハンドラを上書きしないよう addEventListener を使う
export function installErrorListeners(target = globalThis.window) {
  if (!target?.addEventListener) return () => {}
  function onError(event) {
    try {
      const { message, stack } = event.error ? toMessageAndStack(event.error) : { message: event.message, stack: null }
      recordError({ kind: 'error', message, stack, source: event.filename })
    } catch {
      // 計測の失敗でアプリを止めない
    }
  }
  function onRejection(event) {
    try {
      const { message, stack } = toMessageAndStack(event.reason)
      recordError({ kind: 'unhandledrejection', message, stack })
    } catch {
      // 同上
    }
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}

// テスト専用
export function __resetTelemetryForTests() {
  context = { enabled: false, groupId: null }
  lastPageViewPath = null
  lastErrorSentAt.clear()
  errorsSent = 0
}
