import { version as APP_VERSION } from '../../package.json'
import { setForceUpdateRequired } from '@/lib/swUpdate'

export { APP_VERSION }

// "1.2.10" と "1.2.9" のような数値比較。a < b なら負、a > b なら正、同じなら 0
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

// public/version.json は Service Worker のプリキャッシュ対象外なので、常にネットワークから
// 最新の値を取得できる(cache:'no-store'+クエリでHTTPキャッシュも回避)。DB変更等で旧クライアント
// との互換性が失われる場合だけ minSupportedVersion を引き上げてデプロイし、入力中の画面でも
// 強制的に更新を求める
export async function checkMinSupportedVersion(currentVersion = APP_VERSION) {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const { minSupportedVersion } = await res.json()
    const required = Boolean(minSupportedVersion) && compareVersions(currentVersion, minSupportedVersion) < 0
    if (required) setForceUpdateRequired(true)
    return required
  } catch {
    // オフライン等で確認できない場合は何もしない(通常のオンライン利用時に強制する設計のため)
    return false
  }
}
