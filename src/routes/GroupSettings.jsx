import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Link2 } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { buildInviteUrl } from '@/lib/invite'
import { useSubstitutions } from '@/hooks/useSubstitutions'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { APP_VERSION } from '@/lib/appVersion'
import { APP_NAME } from '@/lib/brand'
import { TELEMETRY_NOTICE } from '@/lib/telemetry/notice'

function formatDate(value) {
  return new Date(value).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function GroupSettings({ group }) {
  const [status, setStatus] = useState(null) // { active, expiresAt } | null
  const [issued, setIssued] = useState(null) // 発行直後だけ表示する { url, expiresAt }
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const { disabledRules, enableRule } = useSubstitutions(group.id)
  const { catalog } = useIngredientCatalog()
  const catalogName = (id) => catalog.find((c) => c.id === id)?.name ?? '(不明)'

  const loadStatus = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('get_group_invite_status')
    if (rpcError) return
    const row = Array.isArray(data) ? data[0] : data
    setStatus(row?.invite_active ? { active: true, expiresAt: row.invite_expires_at } : { active: false })
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus, group.id])

  async function handleIssue() {
    setBusy(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('create_group_invite')
    setBusy(false)
    const row = Array.isArray(data) ? data[0] : data
    if (rpcError || !row?.invite_token) {
      setError('招待リンクを発行できませんでした')
      return
    }
    setIssued({ url: buildInviteUrl(window.location.origin, row.invite_token), expiresAt: row.invite_expires_at })
    setStatus({ active: true, expiresAt: row.invite_expires_at })
    setCopied(false)
  }

  async function handleRevoke() {
    setBusy(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('revoke_group_invite')
    setBusy(false)
    if (rpcError) {
      setError('招待リンクを無効にできませんでした')
      return
    }
    setIssued(null)
    setStatus({ active: false })
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(issued.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('コピーできませんでした。リンクを長押ししてコピーしてください')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">グループ</h1>
      <Card>
        <CardHeader>
          <CardTitle>{group.name}</CardTitle>
          <CardDescription>
            招待リンクを共有すると、家族がグループに参加できます。リンクは7日間有効で、発行し直すと前のリンクは使えなくなります
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {issued ? (
            <>
              <div className="text-sm bg-muted rounded-md px-3 py-2 break-all select-all">{issued.url}</div>
              <p className="text-xs text-muted-foreground">
                このリンクは今だけ表示されます。{formatDate(issued.expiresAt)} まで有効です
              </p>
              <Button variant="outline" onClick={handleCopy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? 'コピーしました' : 'リンクをコピー'}
              </Button>
            </>
          ) : status?.active ? (
            <p className="text-sm text-muted-foreground">
              有効な招待リンクがあります({formatDate(status.expiresAt)} まで)。リンクを忘れた場合は発行し直してください
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">有効な招待リンクはありません</p>
          )}
          <Button onClick={handleIssue} disabled={busy}>
            <Link2 className="size-4" />
            {status?.active || issued ? '招待リンクを発行し直す' : '招待リンクを発行'}
          </Button>
          {(status?.active || issued) && (
            <Button variant="ghost" onClick={handleRevoke} disabled={busy}>
              招待リンクを無効にする
            </Button>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>
      {disabledRules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">使わないことにした代替</CardTitle>
            <CardDescription>レシピの判定で、これらの代替は使いません</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {disabledRules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {catalogName(rule.from_catalog_id)} → {catalogName(rule.to_catalog_id)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => enableRule(rule.id)}>
                    戻す
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
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
