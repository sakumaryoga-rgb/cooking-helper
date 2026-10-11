import { useEffect, useState } from 'react'
import { Check, Copy, Download, PlusSquare, Share, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { APP_ICON_SRC } from '@/lib/brand'
import { canPromptInstall, detectPlatform, isIosNonSafari, isStandalone, onInstallPromptChange, promptInstall } from '@/lib/inAppBrowser'

const DISMISS_KEY = 'cookdoor:installGuideDismissed'

function Step({ n, icon: Icon, children }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1 text-sm">{children}</span>
      {Icon && (
        <span className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background" aria-hidden="true">
          <Icon className="size-4" />
        </span>
      )}
    </li>
  )
}

// 「ホーム画面に追加」の案内。スマートフォンのブラウザで開いているときだけ出す(ホーム画面のアプリ・PC では出さない)。
// dismissible のときは「閉じる」で以後出さない(設定の画面からはいつでも見られる)
export function InstallGuide({ dismissible = false, className = '' }) {
  const platform = detectPlatform()
  const [canInstall, setCanInstall] = useState(() => canPromptInstall())
  const [hidden, setHidden] = useState(() => {
    if (!dismissible) return false
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [copied, setCopied] = useState(false)
  useEffect(() => onInstallPromptChange(setCanInstall), [])

  if (hidden || isStandalone() || platform === 'other') return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* 保存できなくても閉じる */
    }
    setHidden(true)
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText('https://cookdoor.app/')
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section aria-label="ホーム画面に追加" className={`relative overflow-hidden rounded-3xl border-2 border-[#3b2a1c] bg-card p-4 shadow-[0_4px_0_#3b2a1c] ${className}`}>
      <span className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-primary/40" aria-hidden="true" />
      {dismissible && (
        <button type="button" onClick={dismiss} aria-label="ホーム画面に追加の案内を閉じる" className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
      <div className="relative flex items-center gap-3 pr-6">
        <img src={APP_ICON_SRC} alt="" width={192} height={192} className="size-12 shrink-0 rounded-2xl shadow-sm" />
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-sm font-bold">
            <Sparkles className="size-4 text-amber-500" />
            ホーム画面に置いて使おう
          </p>
          <p className="text-xs text-muted-foreground">アプリのように、アイコンから1タップで冷蔵庫が開きます</p>
        </div>
      </div>

      {platform === 'android' ? (
        canInstall ? (
          <Button className="relative mt-3 w-full" onClick={() => promptInstall()}>
            <Download />
            ホーム画面に追加する
          </Button>
        ) : (
          <ol className="relative mt-3 flex flex-col gap-2">
            <Step n={1}>画面右上の「︙」(メニュー)を押す</Step>
            <Step n={2} icon={Download}>
              「ホーム画面に追加」か「アプリをインストール」を選ぶ
            </Step>
          </ol>
        )
      ) : isIosNonSafari() ? (
        <div className="relative mt-3 flex flex-col gap-2 text-sm">
          <p>iPhone では Safari から追加します。Safari で cookdoor.app を開いてください</p>
          <Button variant="outline" size="sm" onClick={copyUrl}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'URL をコピーしました' : 'URL をコピーする'}
          </Button>
        </div>
      ) : (
        <ol className="relative mt-3 flex flex-col gap-2">
          <Step n={1} icon={Share}>
            画面下の共有ボタンを押す
          </Step>
          <Step n={2} icon={PlusSquare}>
            「ホーム画面に追加」を選ぶ
          </Step>
          <Step n={3}>右上の「追加」を押す</Step>
        </ol>
      )}
    </section>
  )
}
