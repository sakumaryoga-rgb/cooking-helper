import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { setNeedRefresh, setUpdateFn, setCheckFn } from '@/lib/swUpdate'
import { checkMinSupportedVersion } from '@/lib/appVersion'
import './index.css'
import App from './App.jsx'

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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
