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
