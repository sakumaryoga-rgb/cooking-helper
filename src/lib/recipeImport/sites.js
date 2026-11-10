// 取り込みに対応するレシピサイト。robots.txt でレシピページの取得が禁止されていないことを確認したサイトだけ。
// 取得するのは料理名・人数・材料だけで、調理手順と画像は保存しない。元レシピへのリンクを必ず残す。
// このファイルは Vercel Function(api/recipe-import.js)からも使うため、'@/' の別名を使わない。
// 追加するときは、実際のレシピページで JSON-LD(schema.org/Recipe)から料理名と材料・分量を読めることを確かめる
// (src/lib/recipeImport/sites.test.js の各サイトの形の JSON-LD と、docs/recipe-sites.md の確認記録)。
// id は取り込み記録(recipe_import_runs.site)の制約に合わせて英小文字だけ。color は画面の目印(各社の公式ロゴは使わない)
export const SUPPORTED_SITES = [
  { id: 'kurashiru', name: 'クラシル', color: '#f3793a', hosts: ['www.kurashiru.com', 'kurashiru.com'], path: /^\/recipes\/([0-9a-f-]{36})\/?$/i },
  { id: 'delishkitchen', name: 'DELISH KITCHEN', color: '#f05a5a', hosts: ['delishkitchen.tv', 'www.delishkitchen.tv'], path: /^\/recipes\/(\d{6,20})\/?$/ },
  { id: 'nadia', name: 'Nadia', color: '#c9a063', hosts: ['oceans-nadia.com', 'www.oceans-nadia.com'], path: /^\/user\/(\d+)\/recipe\/(\d+)\/?$/ },
  { id: 'rakuten', name: '楽天レシピ', color: '#bf0000', hosts: ['recipe.rakuten.co.jp'], path: /^\/recipe\/(\d{8,12})\/?$/ },
  { id: 'kyounoryouri', name: 'NHK きょうの料理', color: '#3f7f5f', hosts: ['www.kyounoryouri.jp', 'kyounoryouri.jp'], path: /^\/recipe\/(\d{3,10})_[^/]*\.html$/ },
  { id: 'orangepage', name: 'オレンジページ', color: '#f08300', hosts: ['www.orangepage.net', 'orangepage.net'], path: /^\/recipes\/(\d{3,10})\/?$/ },
  { id: 'lettuceclub', name: 'レタスクラブ', color: '#5f9f3f', hosts: ['www.lettuceclub.net', 'lettuceclub.net'], path: /^\/recipe\/dish\/(\d{2,10})\/?$/ },
  { id: 'ajinomoto', name: '味の素パーク', color: '#d7282f', hosts: ['park.ajinomoto.co.jp'], path: /^\/recipe\/card\/(\d{2,10})\/?$/ },
  { id: 'kikkoman', name: 'キッコーマン ホームクッキング', color: '#c8102e', hosts: ['www.kikkoman.co.jp'], path: /^\/homecook\/search\/recipe\/(\d{8})\/?(?:index\.html)?$/ },
  { id: 'erecipe', name: 'E・レシピ', color: '#e2557a', hosts: ['erecipe.woman.excite.co.jp'], path: /^\/detail\/([0-9a-f]{32})\.html$/ },
  { id: 'macaroni', name: 'macaroni', color: '#e8a33d', hosts: ['macaro-ni.jp'], path: /^\/(\d{3,8})\/?$/ },
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
    // 末尾の「/」は外す(index.html で終わる URL はそのまま)
    const path = u.pathname.replace(/\/$/, '')
    return { site, url: `https://${canonicalHost}${path}`, sourceKey: `${site.id}:${id}` }
  }
  return null
}

export function isAllowedFetchHost(hostname) {
  const host = String(hostname).toLowerCase()
  return SUPPORTED_SITES.some((s) => s.hosts.includes(host))
}

// ------------------------------------------------------------
// 対応サイト以外のページ(汎用の読み取り): schema.org/Recipe の構造化データなどがあれば読み込む
// ここでは URL の形だけを確かめる。実際の宛先(社内のアドレスなどでないか)は、取得する直前に
// サーバー(api/_lib/safeFetch.js)が名前解決の結果で確かめる
// ------------------------------------------------------------
export const GENERIC_SITE_ID = 'generic'
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.test', '.example', '.invalid', '.home.arpa', '.lan', '.intranet', '.corp']
const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|yclid|mc_[a-z]+|igshid|_ga|ref|ref_src)$/i

// 公開されているドメイン名か(IP アドレスの直接指定・ドメインの付かない名前・社内向けの名前は使わない)
export function isPublicHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '')
  if (!host || host.length > 253 || host.includes(':') || host.startsWith('[')) return false
  if (/^\d+(\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+/i.test(host)) return false
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false
  const labels = host.split('.')
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return false
  return /^[a-z]{2,63}$|^xn--[a-z0-9-]{1,59}$/.test(labels.at(-1))
}

// 汎用の読み取りで試せる URL なら { site: { id: 'generic', name: ドメイン }, url(https に正規化), generic: true } を返す
export function parseGenericUrl(input) {
  let u
  try {
    u = new URL(String(input ?? '').trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null
  if (u.port && !(u.protocol === 'https:' && u.port === '443') && !(u.protocol === 'http:' && u.port === '80')) return null
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!isPublicHostname(host)) return null
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key)
  const search = u.searchParams.toString()
  const url = `https://${host}${u.pathname}${search ? `?${search}` : ''}`
  if (url.length > 2000) return null
  return { site: { id: GENERIC_SITE_ID, name: host.slice(0, 40) }, url, generic: true, sourceKey: null }
}

// 取り込む URL: 対応サイトのドメインならそのサイトの形(レシピのページでなければ null)、それ以外は汎用の読み取り
export function parseImportUrl(input) {
  const supported = parseRecipeUrl(input)
  if (supported) return supported
  let host = ''
  try {
    host = new URL(String(input ?? '').trim()).hostname.toLowerCase()
  } catch {
    return null
  }
  if (isAllowedFetchHost(host)) return null
  return parseGenericUrl(input)
}

// 汎用の読み取りで取り込んだレシピの重複を見分けるキー(URL の SHA-256 の先頭32桁)。recipes.source_key の形に合う
export async function genericSourceKey(url) {
  const data = new TextEncoder().encode(String(url))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `web:${hex.slice(0, 32)}`
}
