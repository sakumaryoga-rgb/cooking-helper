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

// workbox-window は「登録した時点で既に SW に制御されていたページ」でしか自動リロードしない。
// 初回訪問のセッション中に更新が来た場合は、新しい SW が有効になってもリロードされず、
// 更新ダイアログが出たままになる(ローカル検証で確認)。そのため controllerchange を
// 自分でも待ち受け、制御が新しい SW に移った時点で必ずリロードする。
let reloadScheduled = false
export function applyUpdate({ serviceWorker = globalThis.navigator?.serviceWorker, reload = () => window.location.reload() } = {}) {
  if (serviceWorker && !reloadScheduled) {
    reloadScheduled = true
    serviceWorker.addEventListener('controllerchange', () => reload(), { once: true })
  }
  updateFn?.(true)
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
}
