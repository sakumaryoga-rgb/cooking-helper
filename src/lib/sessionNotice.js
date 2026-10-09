// 自分で「サインアウト」を押したのか、ログインの有効期限切れなどで切れたのかを区別して、ログイン画面で知らせる。
// 保存するのは印だけ(トークンやメールアドレスは保存しない)。
const REQUESTED = 'cookdoor.signOutRequested'
const EXPIRED = 'cookdoor.sessionExpired'

function safe(fn) {
  try {
    return fn()
  } catch {
    return null
  }
}

export function markSignOutRequested() {
  safe(() => sessionStorage.setItem(REQUESTED, '1'))
}

export function handleSignedOut() {
  const requested = safe(() => sessionStorage.getItem(REQUESTED)) === '1'
  safe(() => sessionStorage.removeItem(REQUESTED))
  if (!requested) safe(() => localStorage.setItem(EXPIRED, '1'))
}

export function takeSessionExpired() {
  const expired = safe(() => localStorage.getItem(EXPIRED)) === '1'
  safe(() => localStorage.removeItem(EXPIRED))
  return expired
}
