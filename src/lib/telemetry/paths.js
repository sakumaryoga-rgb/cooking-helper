import { matchPath } from 'react-router-dom'

// 計測に使う画面パス。App.jsx の Route と対応させる。
// 動的な部分(レシピの ID)は :id にまとめ、一覧にない URL は /other にする。
// クエリ文字列(招待コード)とハッシュは使わない。
const ROUTE_PATTERNS = [
  '/',
  '/login',
  '/auth/callback',
  '/onboarding',
  '/fridge',
  '/recipes',
  '/recipes/new',
  '/recipes/:id',
  '/group',
]

export function normalizePath(pathname) {
  const path = String(pathname || '/').split(/[?#]/)[0]
  for (const pattern of ROUTE_PATTERNS) {
    if (matchPath({ path: pattern, end: true }, path)) return pattern
  }
  return '/other'
}
