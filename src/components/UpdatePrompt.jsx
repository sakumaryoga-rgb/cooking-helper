import { useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { applyUpdate, getState, subscribe } from '@/lib/swUpdate'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { APP_NAME } from '@/lib/brand'

// レシピの入力中(/recipes/new)と、調理の確定ダイアログを開いている間(setBusy)は、
// 通常の新バージョン検知では全画面ブロックにせず、入力の妨げにならないバナーに留める。
// 入力を終えると判定が変わり、自動的にブロッキング表示になる。
// DB変更等で互換性がなくなる場合(forceUpdateRequired)は、入力中でも常にブロッキング表示にする。
function isInputRoute(pathname) {
  return pathname === '/recipes/new'
}

export function UpdatePrompt() {
  const { needRefresh, forceUpdateRequired, busy } = useSyncExternalStore(subscribe, getState)
  const { pathname } = useLocation()

  if (!needRefresh && !forceUpdateRequired) return null

  const blocking = forceUpdateRequired || !(busy || isInputRoute(pathname))

  if (!blocking) {
    return (
      <div role="status" className="fixed inset-x-0 bottom-20 z-[100] flex justify-center px-4">
        <div className="flex items-center gap-2 rounded-full bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10">
          <RefreshCw className="size-4 shrink-0 text-primary" />
          {APP_NAME} の新しいバージョンがあります。入力が終わったら更新できます
        </div>
      </div>
    )
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-prompt-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl bg-popover p-6 text-center text-popover-foreground ring-1 ring-foreground/10">
        <div
          className={cn(
            'flex size-12 items-center justify-center rounded-full',
            forceUpdateRequired ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
          )}
        >
          {forceUpdateRequired ? <TriangleAlert className="size-6" /> : <RefreshCw className="size-6" />}
        </div>
        <div className="flex flex-col gap-1">
          <p id="update-prompt-title" className="font-medium">
            {forceUpdateRequired ? `${APP_NAME} の重要な更新が必要です` : `${APP_NAME} の新しいバージョンがあります`}
          </p>
          <p className="text-sm text-muted-foreground">
            {forceUpdateRequired
              ? 'このバージョンは利用できません。今すぐ更新してください'
              : '「更新する」を押すと最新の状態になります'}
          </p>
        </div>
        <Button className="w-full" onClick={() => applyUpdate()}>
          更新する
        </Button>
      </div>
    </div>
  )
}
