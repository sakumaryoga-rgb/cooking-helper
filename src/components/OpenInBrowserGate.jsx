import { useState } from 'react'
import { Check, Compass, Copy, ExternalLink, MoreHorizontal } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { HouseArt } from '@/components/HouseArt'
import { Button } from '@/components/ui/button'
import { detectPlatform, externalBrowserUrl } from '@/lib/inAppBrowser'

export const CONTINUE_KEY = 'cookdoor:inAppContinue'

// アプリ(LINE・Instagram など)の中のブラウザで開かれたときの全面の案内。
// LINE は自動で外部ブラウザへ送る(lib/inAppBrowser の redirectOutOfLine)ので、ここに来るのはそれ以外のアプリか、送れなかったとき
export function OpenInBrowserGate({ appName, onContinue }) {
  const platform = detectPlatform()
  const browser = platform === 'ios' ? 'Safari' : 'Chrome'
  const external = externalBrowserUrl(appName)
  const [copied, setCopied] = useState(false)

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      setCopied(false)
    }
  }

  function openExternal() {
    if (external) window.location.href = external
    else copyUrl()
  }

  // アプリごとの「ブラウザで開く」の場所
  const menuHint =
    appName === 'LINE'
      ? platform === 'ios'
        ? '画面右下の「共有」または「…」から「Safariで開く」'
        : '画面右上の「︙」から「他のアプリで開く」'
      : appName === 'Instagram' || appName === 'Threads'
        ? '画面右上の「…」から「外部ブラウザで開く」'
        : appName === 'X'
          ? '画面右上の共有アイコンから「ブラウザで開く」'
          : '画面のメニュー(「…」や「︙」)から「ブラウザで開く」'

  return (
    <div className="min-h-svh bg-[radial-gradient(circle_at_50%_0%,#fff3b0_0%,transparent_60%)] px-4 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-5 py-8">
        <BrandMark size="sm" className="self-center text-sm" />
        <section className="flex flex-col items-center gap-3 text-center">
          <HouseArt open={false} floating />
          <h1 className="text-2xl font-bold leading-snug tracking-tight">
            {browser} で開くと、
            <br />
            扉が開きます
          </h1>
          <p className="text-sm text-muted-foreground">
            いまは {appName} の中のブラウザで開いています。ここではログインやホーム画面への追加ができないので、{browser} で開いてください
          </p>
        </section>

        <div className="flex flex-col gap-3 rounded-3xl border-2 border-[#3b2a1c] bg-card p-4 shadow-[0_4px_0_#3b2a1c]">
          {external ? (
            <Button size="lg" onClick={openExternal}>
              <ExternalLink />
              {browser} で開く
            </Button>
          ) : (
            <Button size="lg" onClick={copyUrl}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'URL をコピーしました' : 'URL をコピーする'}
            </Button>
          )}
          <ol className="flex flex-col gap-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
              <span>
                <MoreHorizontal className="mr-1 inline size-4 align-text-bottom" />
                {menuHint}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
              <span>
                <Compass className="mr-1 inline size-4 align-text-bottom" />
                開けないときは、コピーした URL を {browser} のアドレス欄に貼り付けます
              </span>
            </li>
          </ol>
          {external && (
            <button type="button" className="self-start text-xs font-medium underline underline-offset-2" onClick={copyUrl}>
              {copied ? 'URL をコピーしました' : 'URL をコピーする'}
            </button>
          )}
        </div>

        <button
          type="button"
          className="self-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => {
            try {
              sessionStorage.setItem(CONTINUE_KEY, '1')
            } catch {
              /* 保存できなくても、この画面を閉じる */
            }
            onContinue()
          }}
        >
          このまま {appName} の中で見る
        </button>
      </div>
    </div>
  )
}
