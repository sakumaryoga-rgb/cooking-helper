// 招待リンクは https://cookdoor.app/onboarding#invite=<トークン> の形。
// トークンを URL のハッシュに置くのは、サーバーやアクセスログに送られないようにするため。
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const PENDING_KEY = 'pendingInviteToken'
const LEGACY_KEY = 'pendingInviteCode'

export function buildInviteUrl(origin, token) {
  return `${origin}/onboarding#invite=${token}`
}

// 招待リンク全体、ハッシュ部分、トークンだけ、のどれを貼っても取り出す
export function parseInviteToken(input) {
  const text = String(input ?? '').trim()
  if (TOKEN_RE.test(text)) return text
  const match = text.match(/(?:^|[#&?])invite=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/)
  return match ? match[1] : null
}

function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

// 招待リンクを開いたとき(未ログインでも)トークンを覚えておき、URL からは消す
export function capturePendingInvite(location, replaceUrl) {
  const token = parseInviteToken(location.hash)
  const hadLegacyCode = new URLSearchParams(location.search).has('code')
  const store = storage()
  if (token) {
    store?.setItem(PENDING_KEY, token)
    replaceUrl?.(location.pathname)
  } else if (hadLegacyCode) {
    store?.setItem(LEGACY_KEY, '1')
    replaceUrl?.(location.pathname)
  }
}

// 1回だけ取り出す
export function takePendingInvite() {
  const store = storage()
  const token = store?.getItem(PENDING_KEY) ?? null
  const legacy = store?.getItem(LEGACY_KEY) != null
  store?.removeItem(PENDING_KEY)
  store?.removeItem(LEGACY_KEY)
  return { token: parseInviteToken(token), legacy }
}
