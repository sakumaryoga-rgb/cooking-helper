// この端末で使った家とログインのメールアドレスを覚える(ログインし直したときに、どの家に入るかを一目で出すため)。
// 覚えるのはこの端末の中だけ(サーバーには送らない)。サインアウトで消せる
// - houses: 最後に読んだ「所属している家」の一覧 [{ id, name }]
// - email: 最後にログインリンクを送ったメールアドレス(入力の手間を省く)
// - invites: 招待で入った家の招待リンクの控え [{ groupId, name, token }](抜けた家に招待なしで戻るため。期限内だけ使える)
const KEY = 'cookdoor.loginMemory'
const MAX_INVITES = 10

function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function getLoginMemory() {
  try {
    const v = JSON.parse(storage()?.getItem(KEY) ?? 'null')
    return {
      houses: Array.isArray(v?.houses) ? v.houses.filter((h) => h && typeof h.id === 'string' && typeof h.name === 'string') : [],
      email: typeof v?.email === 'string' ? v.email : '',
      invites: Array.isArray(v?.invites) ? v.invites.filter((i) => i && typeof i.groupId === 'string' && typeof i.token === 'string') : [],
    }
  } catch {
    return { houses: [], email: '', invites: [] }
  }
}

function save(patch) {
  const next = { ...getLoginMemory(), ...patch }
  try {
    storage()?.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 覚えられなくてもログインはできる */
  }
  return next
}

export function rememberHouses(groups) {
  save({ houses: (groups ?? []).map((g) => ({ id: g.id, name: g.name })) })
}

export function rememberEmail(email) {
  const v = String(email ?? '').trim()
  if (v) save({ email: v })
}

export function rememberInvite({ groupId, name, token }) {
  if (!groupId || !token) return
  const rest = getLoginMemory().invites.filter((i) => i.groupId !== groupId)
  save({ invites: [{ groupId, name: name ?? '', token }, ...rest].slice(0, MAX_INVITES) })
}

export function forgetLoginMemory() {
  try {
    storage()?.removeItem(KEY)
  } catch {
    /* noop */
  }
}
