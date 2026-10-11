// LINE・Instagram などのアプリ内ブラウザ(WebView)は、Safari / Chrome とログインの保存場所が別で、
// ホーム画面への追加もできない。アプリ内ブラウザで開かれたら、標準のブラウザで開き直してもらう。
const IN_APP_BROWSERS = [
  { name: 'LINE', pattern: /\bLine\//i },
  { name: 'Instagram', pattern: /\bInstagram\b/i },
  { name: 'Facebook', pattern: /FBAN|FBAV|FB_IAB/i },
  { name: 'X', pattern: /\bTwitter\b/i },
  { name: 'Threads', pattern: /\bBarcelona\b/i },
  { name: 'KakaoTalk', pattern: /KAKAOTALK/i },
  { name: 'Yahoo!', pattern: /YJApp/i },
]

const LINE_PARAM = 'openExternalBrowser'

export function detectInAppBrowser(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '') {
  return IN_APP_BROWSERS.find(({ pattern }) => pattern.test(ua))?.name ?? null
}

export function detectPlatform(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '') {
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

// iOS の Safari 以外のブラウザ(Chrome・Firefox など)。iOS ではホーム画面への追加は Safari からが確実
export function isIosNonSafari(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '') {
  return detectPlatform(ua) === 'ios' && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua)
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone)
}

// 標準のブラウザで開き直す URL。LINE は ?openExternalBrowser=1 で外部ブラウザに渡してくれる。
// 招待リンク(#invite=…)やログインのリンクの内容は、そのまま引き継ぐ
export function externalBrowserUrl(appName, href = typeof window === 'undefined' ? '' : window.location.href) {
  if (!href) return null
  if (appName === 'LINE') {
    const url = new URL(href)
    url.searchParams.set(LINE_PARAM, '1')
    return url.toString()
  }
  if (appName === 'KakaoTalk') return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`
  return null
}

// LINE で開かれたら、画面を出す前に1回だけ自動で外部ブラウザへ送る。
// すでに送ったのに LINE のまま戻ってきた(パラメータが付いている)ときは、繰り返さずに案内の画面を出す
export function redirectOutOfLine() {
  if (typeof window === 'undefined') return false
  if (detectInAppBrowser() !== 'LINE') return false
  const url = new URL(window.location.href)
  if (url.searchParams.has(LINE_PARAM)) return false
  window.location.replace(externalBrowserUrl('LINE', url.toString()))
  return true
}

// 外部ブラウザで開いたあと、URL に残ったパラメータを消す(共有やブックマークに残さない)
export function cleanExternalParam() {
  if (typeof window === 'undefined' || detectInAppBrowser()) return
  const url = new URL(window.location.href)
  if (!url.searchParams.has(LINE_PARAM)) return
  url.searchParams.delete(LINE_PARAM)
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

// Android の Chrome などが出す「インストール」の合図を、起動直後から覚えておく(あとでボタンから出す)
let deferredPrompt = null
const listeners = new Set()
export function captureInstallPrompt() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    listeners.forEach((fn) => fn(true))
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    listeners.forEach((fn) => fn(false))
  })
}
export function canPromptInstall() {
  return Boolean(deferredPrompt)
}
export function onInstallPromptChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export async function promptInstall() {
  if (!deferredPrompt) return false
  const e = deferredPrompt
  deferredPrompt = null
  listeners.forEach((fn) => fn(false))
  await e.prompt()
  const choice = await e.userChoice.catch(() => null)
  return choice?.outcome === 'accepted'
}
