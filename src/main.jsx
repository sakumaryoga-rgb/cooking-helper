import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { setNeedRefresh, setUpdateFn, setCheckFn } from '@/lib/swUpdate'
import { checkMinSupportedVersion } from '@/lib/appVersion'
import './index.css'
import App from './App.jsx'
import { captureInstallPrompt, cleanExternalParam, redirectOutOfLine } from '@/lib/inAppBrowser'

// LINE で開かれたら、画面を出す前に外部ブラウザ(Safari / Chrome)へ送る
const leavingLine = redirectOutOfLine()
cleanExternalParam()
captureInstallPrompt()

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

// 新しいバージョンを検知したら UpdatePrompt で「更新する」を押すまで待つ(入力中の内容を
// 勝手なリロードで消さないため)。検知は起動時、1時間ごと、フォアグラウンド復帰時に行う。
// iOS のホーム画面アプリは長時間バックグラウンドに回るとページごと破棄され setInterval も
// 失われるので、復帰時のチェックが実質的な主経路になる。
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    function runUpdateCheck() {
      registration?.update()
      checkMinSupportedVersion()
    }
    runUpdateCheck()
    setCheckFn(runUpdateCheck)
    if (!registration) return
    setInterval(runUpdateCheck, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') runUpdateCheck()
    })
  },
  onNeedRefresh() {
    setNeedRefresh(true)
  },
})
setUpdateFn(updateSW)

// 新しい SW はインストールされるとすぐ有効になる(vite.config.js の skipWaiting)。
// 開いている画面が古いままなら「新しいバージョンがあります」を出し、入力が終わってから読み直してもらう
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) setNeedRefresh(true)
  })
}
// 古い画面が、新しい版で消えたファイル(画面ごとの JS)を読み込めなかったら、新しい版として読み直す
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault?.()
  setNeedRefresh(true)
})

createRoot(document.getElementById('root')).render(
  leavingLine ? (
    // 外部ブラウザへ移るあいだ(LINE のまま残ったときは、外部ブラウザで開くと出るはずの案内をここに)
    <p style={{ padding: 24, textAlign: 'center', fontFamily: 'system-ui', color: '#3b2a1c' }}>ブラウザで開いています…</p>
  ) : (
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>
  )
)
