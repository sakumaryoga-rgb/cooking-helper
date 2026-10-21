// main.jsx(Reactツリーの外)でService Workerの更新登録を行うため、更新の有無を
// Reactコンポーネント側へ橋渡しする小さなpub/sub。useSyncExternalStoreで購読する。
// BASKETBALL STATS の src/lib/swUpdate.js を元にしている。
//
// needRefresh: 通常の新バージョン検知(SWのonNeedRefresh)。入力中(レシピ追加・調理の確定)は
//   非ブロッキング表示に留め、入力が終わるとブロッキング表示へ切り替える
// forceUpdateRequired: DB変更等で旧クライアントとの互換性がなくなった場合の強制更新
//   (appVersion.jsのcheckMinSupportedVersion)。入力中でも常にブロッキング表示にする
// busyKeys: 入力中の画面・ダイアログが登録するキー。1つでもあれば「入力中」とみなす
let state = { needRefresh: false, forceUpdateRequired: false, busy: false }
let updateFn = null
let checkFn = null
const busyKeys = new Set()
const listeners = new Set()

function emit() {
  listeners.forEach((listener) => listener())
}

export function setNeedRefresh(value) {
  state = { ...state, needRefresh: value }
  emit()
}

export function setForceUpdateRequired(value) {
  state = { ...state, forceUpdateRequired: value }
  emit()
}

// 入力中の画面・ダイアログから呼ぶ。key ごとに管理するので、複数箇所が同時に入力中でも
// すべて終わるまで busy のままになる
export function setBusy(key, value) {
  if (value) busyKeys.add(key)
  else busyKeys.delete(key)
  const busy = busyKeys.size > 0
  if (busy !== state.busy) {
    state = { ...state, busy }
    emit()
  }
}

export function setUpdateFn(fn) {
  updateFn = fn
}

// 「更新する」: 待機中の新しい SW があれば有効にしてから、なければすぐに読み直す。
// - workbox-window は「登録した時点で既に SW に制御されていたページ」でしか自動リロードしないので、
//   controllerchange を自分でも待ち受ける
// - 端末によっては(iPhone のホーム画面アプリなど)待機中の SW が有効にならず、制御も移らないことがある。
//   その場合も一定時間後に必ず読み直す(「更新する」を押しても何も起きない状態を作らない)
// - 前回の「更新する」から2分以内にもう一度押された = 前回の更新で直らなかった。
//   SW の登録とキャッシュを消して、ネットワークから最新版を読み直す(更新の画面から抜け出せなくなるのを防ぐ)。
//   ログイン状態や選んでいる家(localStorage)は消さない
const LAST_ATTEMPT_KEY = 'cookdoor:updateAttemptAt'
const RETRY_WINDOW_MS = 2 * 60 * 1000
const FALLBACK_RELOAD_MS = 4000
let reloadScheduled = false

function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export async function hardReload({ serviceWorker = globalThis.navigator?.serviceWorker, cacheStorage = globalThis.caches, reload = () => window.location.reload() } = {}) {
  try {
    const regs = (await serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    /* 消せなくても読み直す */
  }
  try {
    const keys = (await cacheStorage?.keys?.()) ?? []
    await Promise.all(keys.map((k) => cacheStorage.delete(k)))
  } catch {
    /* 消せなくても読み直す */
  }
  reload()
}

export async function applyUpdate({
  serviceWorker = globalThis.navigator?.serviceWorker,
  cacheStorage = globalThis.caches,
  reload = () => window.location.reload(),
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  const store = storage()
  const last = Number(store?.getItem(LAST_ATTEMPT_KEY)) || 0
  try {
    store?.setItem(LAST_ATTEMPT_KEY, String(now()))
  } catch {
    /* 覚えられなくても更新はする */
  }
  if (last && now() - last < RETRY_WINDOW_MS) {
    await hardReload({ serviceWorker, cacheStorage, reload })
    return
  }
  if (reloadScheduled) return
  reloadScheduled = true
  let reloaded = false
  const reloadOnce = () => {
    if (reloaded) return
    reloaded = true
    reload()
  }
  serviceWorker?.addEventListener?.('controllerchange', reloadOnce, { once: true })
  updateFn?.(true)
  let waiting = null
  try {
    waiting = (await serviceWorker?.getRegistration?.())?.waiting ?? null
  } catch {
    waiting = null
  }
  // workbox に頼らず、待機中の SW に直接「有効になって」と伝える
  waiting?.postMessage?.({ type: 'SKIP_WAITING' })
  setTimer(reloadOnce, waiting ? FALLBACK_RELOAD_MS : 0)
}

export function setCheckFn(fn) {
  checkFn = fn
}

// フォアグラウンド復帰時などから能動的に更新チェックを呼び出す
export function checkForUpdate() {
  checkFn?.()
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState() {
  return state
}

// テスト専用: モジュール状態を初期化する
export function __resetForTests() {
  state = { needRefresh: false, forceUpdateRequired: false, busy: false }
  updateFn = null
  checkFn = null
  busyKeys.clear()
  listeners.clear()
  reloadScheduled = false
  try {
    globalThis.localStorage?.removeItem(LAST_ATTEMPT_KEY)
  } catch {
    /* noop */
  }
}
