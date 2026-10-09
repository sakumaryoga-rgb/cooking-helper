// 自分のメールアドレスを画面に出すときは一部を伏せる(例: ta***@gm***.com)
export function maskEmail(email) {
  const m = String(email ?? '').match(/^([^@]+)@([^.]+)(\..+)?$/)
  if (!m) return ''
  const keep = (s) => (s.length <= 2 ? s[0] ?? '' : s.slice(0, 2))
  return `${keep(m[1])}***@${keep(m[2])}***${m[3] ?? ''}`
}
