// この端末で選んでいる家(グループ)。端末ごとに覚え、次回の起動時に復元する。
// すべての DB 呼び出しに x-cookdoor-group ヘッダーで付け、DB 側で本人の所属を確かめてから使う(migration 021)。
// ここに入れるのはグループの ID(UUID)だけで、ログイン情報やメールアドレスは入れない。
const STORAGE_KEY = 'cookdoor.activeGroupId'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let activeGroupId = null

function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function getActiveGroupId() {
  return activeGroupId
}

export function getStoredGroupId() {
  const v = storage()?.getItem(STORAGE_KEY)
  return v && UUID_RE.test(v) ? v : null
}

export function setActiveGroupId(id) {
  activeGroupId = id && UUID_RE.test(id) ? id : null
  try {
    if (activeGroupId) storage()?.setItem(STORAGE_KEY, activeGroupId)
  } catch {
    // 保存できなくても、この起動中は使える
  }
}

// 所属している家の中から、前回選んだ家(なければ最初に参加した家)を選ぶ
export function pickActiveGroup(groups) {
  const stored = getStoredGroupId()
  return groups.find((g) => g.id === stored) ?? groups[0] ?? null
}

// supabase-js の fetch に、選んでいる家のヘッダーを付ける
export function withGroupHeader(fetchImpl = globalThis.fetch) {
  return (input, init = {}) => {
    if (!activeGroupId) return fetchImpl(input, init)
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set('x-cookdoor-group', activeGroupId)
    return fetchImpl(input, { ...init, headers })
  }
}

export function __resetActiveGroupForTests() {
  activeGroupId = null
}
