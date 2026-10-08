// client_errors に送る前に、エラーの文面から個人情報・秘密情報になりうる部分を伏せる。
// DB 側でも長さと形式を制限しているが、送る前に消すのが第一の防御。

export const MAX_MESSAGE_LENGTH = 500
export const MAX_STACK_LENGTH = 2000
const MAX_STACK_FRAMES = 12

// アプリ自身のファイルの URL だけはパスを残す(どのファイルのどこで起きたかが分かるように)
const APP_HOSTS = /^(?:cookdoor\.app|[a-z0-9-]+\.vercel\.app|localhost|127\.0\.0\.1)(?::\d+)?$/i

function maskUrl(url) {
  try {
    const u = new URL(url)
    if (APP_HOSTS.test(u.host) && /^\/assets\//.test(u.pathname)) {
      // スタックの「ファイル:行:列」は残し、クエリとハッシュは捨てる
      return u.pathname
    }
  } catch {
    // URL として読めないものは丸ごと伏せる
  }
  return '[url]'
}

export function maskSecrets(text) {
  return (
    String(text)
      // URL(レシピの参照先 URL、招待リンク、Supabase の URL など)
      .replace(/\b(?:https?|wss?):\/\/[^\s"'<>()]+/gi, maskUrl)
      // Authorization ヘッダー、JWT
      .replace(/Bearer\s+[A-Za-z0-9\-_.~+/=]+/gi, 'Bearer [redacted]')
      .replace(/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+(?:\.[A-Za-z0-9\-_]*)?/g, '[jwt]')
      // key=value 形式のトークンやコード
      .replace(/\b(access_token|refresh_token|token|apikey|api_key|password|code|key)=([^&\s"']+)/gi, '$1=[redacted]')
      // メールアドレス
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
      // UUID(レシピ、食材、ユーザー、グループの ID)
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
      // 招待コード(英大文字と数字の8文字)
      .replace(/\b(?=[0-9A-F]*[0-9])(?=[0-9A-F]*[A-F])[0-9A-F]{8}\b/g, '[code]')
      // 長いランダム文字列(トークン類)
      .replace(/\b[A-Za-z0-9\-_]{32,}\b/g, '[token]')
      // 引用符の中の文章(食材名、レシピ名、入力内容が入りうる)。
      // 日本語を含むもの、空白を含むもの、30文字を超えるものは伏せる。プロパティ名のような短い英数字は残す
      .replace(/(["'「『])([^"'」』\n]*)(["'」』])/g, (match, open, inner, close) =>
        /[^\x20-\x7e]|\s/.test(inner) || inner.length > 30 ? `${open}[text]${close}` : match
      )
  )
}

export function sanitizeMessage(message) {
  const text = maskSecrets(message ?? '').replace(/\s+/g, ' ').trim()
  return (text || '(no message)').slice(0, MAX_MESSAGE_LENGTH)
}

export function sanitizeStack(stack) {
  if (!stack) return null
  const frames = String(stack).split('\n').slice(0, MAX_STACK_FRAMES)
  const text = maskSecrets(frames.join('\n')).trim()
  return text ? text.slice(0, MAX_STACK_LENGTH) : null
}

// 同じエラーをまとめるための8桁の16進数(FNV-1a)。伏せ字にした後の文面から作る
export function fingerprintOf(...parts) {
  let hash = 0x811c9dc5
  for (const ch of parts.join('\u0000')) {
    hash ^= ch.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
