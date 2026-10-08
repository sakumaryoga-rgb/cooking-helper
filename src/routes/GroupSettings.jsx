import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { APP_VERSION } from '@/lib/appVersion'
import { APP_NAME } from '@/lib/brand'
import { TELEMETRY_NOTICE } from '@/lib/telemetry/notice'

export function GroupSettings({ group }) {
  const [copied, setCopied] = useState(false)
  const inviteUrl = `${window.location.origin}/onboarding?code=${group.invite_code}`

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">グループ</h1>
      <Card>
        <CardHeader>
          <CardTitle>{group.name}</CardTitle>
          <CardDescription>このリンクを共有すると、家族・友人がグループに参加できます</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="text-sm bg-muted rounded-md px-3 py-2 break-all">{inviteUrl}</div>
          <Button variant="outline" onClick={handleCopy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'コピーしました' : 'リンクをコピー'}
          </Button>
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        {APP_NAME} バージョン {APP_VERSION}
      </p>
      <p className="text-center text-xs text-muted-foreground">{TELEMETRY_NOTICE}</p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer text-center">ホーム画面のアイコンが古いままの場合</summary>
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2.5">
          <p>iPhone のホーム画面のアイコンと名前は、追加したときのまま残ることがあります。アプリの中身は最新になっているので、そのまま使い続けて問題ありません。</p>
          <p>新しいアイコンにしたい場合だけ、Safari で cookdoor.app を開き、共有ボタンから「ホーム画面に追加」で追加し直してください。</p>
          <p>追加し直すとログインし直しが必要になることがあります。古いアイコンは、新しいアイコンでログインできたのを確かめてから削除してください。</p>
        </div>
      </details>
    </div>
  )
}
