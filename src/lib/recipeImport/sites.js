// 取り込みに対応するレシピサイト。robots.txt でレシピページの取得が禁止されていないことを確認したサイトだけ。
// 取得するのは料理名・人数・材料だけで、調理手順と画像は保存しない。元レシピへのリンクを必ず残す。
// このファイルは Vercel Function(api/recipe-import.js)からも使うため、'@/' の別名を使わない。
export const SUPPORTED_SITES = [
  { id: 'kurashiru', name: 'クラシル', hosts: ['www.kurashiru.com', 'kurashiru.com'], path: /^\/recipes\/([0-9a-f-]{36})\/?$/i },
  { id: 'delishkitchen', name: 'DELISH KITCHEN', hosts: ['delishkitchen.tv', 'www.delishkitchen.tv'], path: /^\/recipes\/(\d{6,20})\/?$/ },
  { id: 'nadia', name: 'Nadia', hosts: ['oceans-nadia.com', 'www.oceans-nadia.com'], path: /^\/user\/(\d+)\/recipe\/(\d+)\/?$/ },
]

// 取り込めるレシピ URL なら { site, url(正規化済み), sourceKey } を返す。それ以外は null
export function parseRecipeUrl(input) {
  let u
  try {
    u = new URL(String(input ?? '').trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  for (const site of SUPPORTED_SITES) {
    if (!site.hosts.includes(host)) continue
    const m = u.pathname.match(site.path)
    if (!m) return null
    const id = m.slice(1).join('/').toLowerCase()
    const canonicalHost = site.hosts[0]
    const path = u.pathname.replace(/\/$/, '')
    return { site, url: `https://${canonicalHost}${path}`, sourceKey: `${site.id}:${id}` }
  }
  return null
}

export function isAllowedFetchHost(hostname) {
  const host = String(hostname).toLowerCase()
  return SUPPORTED_SITES.some((s) => s.hosts.includes(host))
}
