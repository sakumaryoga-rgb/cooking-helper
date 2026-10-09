import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Crown, Link2, LogOut, Settings2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { HouseSwitcher } from '@/components/HouseSwitcher'
import { memberLabel, useHouseMembers } from '@/hooks/useHouseMembers'
import { maskEmail } from '@/lib/maskEmail'
import { markSignOutRequested } from '@/lib/sessionNotice'
import { parseInviteToken } from '@/lib/invite'
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

// 管理画面へのリンクを出すかどうかだけに使う(管理画面の権限はサーバー側で判断する)
function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    let cancelled = false
    supabase.rpc('is_app_admin').then(({ data }) => {
      if (!cancelled) setIsAdmin(data === true)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return isAdmin
}

// 設定(設計書 4 章): 家族グループ、招待、メンバー、アカウント、規約、バージョン。課金は枠だけ
export function Settings({ group, groups = [group], onSelectGroup, onGroupsChanged, email, userId }) {
  const { members } = useHouseMembers(group.id)
  const navigate = useNavigate()
  const [houseMessage, setHouseMessage] = useState('')
  const [houseBusy, setHouseBusy] = useState(false)

  function switchTo(id) {
    onSelectGroup?.(id)
    navigate('/')
  }

  async function createHouse(name) {
    setHouseBusy(true)
    setHouseMessage('')
    const { data, error: rpcError } = await supabase.rpc('create_group', { group_name: name })
    setHouseBusy(false)
    if (rpcError || !data?.id) {
      setHouseMessage(rpcError?.message ?? '家を建てられませんでした')
      return false
    }
    await onGroupsChanged?.(data.id)
    navigate('/')
    return true
  }

  async function joinHouse(link) {
    const token = parseInviteToken(link)
    if (!token) {
      setHouseMessage('招待リンクをそのまま貼り付けてください')
      return false
    }
    setHouseBusy(true)
    setHouseMessage('')
    const { data, error: rpcError } = await supabase.rpc('join_group_with_invite', { p_token: token })
    setHouseBusy(false)
    if (rpcError) {
      setHouseMessage(rpcError.message)
      return false
    }
    if (!data?.id) {
      setHouseMessage('招待リンクが無効か、期限が切れています。家族に新しい招待リンクを発行してもらってください')
      return false
    }
    await onGroupsChanged?.(data.id)
    navigate('/')
    return true
  }
  const isAdmin = useIsAdmin()
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

  // この端末だけをログアウトする(他の端末のログインは残す、v1.1.1)
  async function handleSignOut() {
    markSignOutRequested()
    await supabase.auth.signOut({ scope: 'local' })
  }

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
      <h1 className="text-lg font-medium">設定</h1>
      <Card>
        <CardContent className="pt-1">
          <HouseSwitcher
            groups={groups}
            currentId={group.id}
            onSelect={switchTo}
            onManage={(id) => navigate(`/settings/houses/${id}`)}
            onCreate={createHouse}
            onJoin={joinHouse}
            busy={houseBusy}
            message={houseMessage}
          />
        </CardContent>
      </Card>
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">メンバー({members.length}人)</CardTitle>
          <CardDescription>この家で冷蔵庫とレシピを共有しています</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1 text-sm">
            {members.map((m, i) => (
              <li key={m.user_id} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  {memberLabel(m, i, userId)}
                  {m.display_name && m.user_id === userId && <span className="text-xs text-muted-foreground">(あなた)</span>}
                  {m.role === 'owner' && <Crown className="size-3.5 text-amber-500" aria-label="管理者" />}
                </span>
                <span className="text-xs text-muted-foreground">{new Date(m.joined_at).toLocaleDateString('ja-JP')} 参加</span>
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => navigate(`/settings/houses/${group.id}`)}>
            <Settings2 className="size-4" />
            この家の管理
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">アカウント</CardTitle>
          <CardDescription>{maskEmail(email)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            <LogOut className="size-4" />
            この端末でサインアウト
          </Button>
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">プラン</CardTitle>
          <CardDescription>準備中です</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Link to="/contact" className="underline-offset-2 hover:underline">
            お問い合わせ
          </Link>
          <Link to="/terms" className="underline-offset-2 hover:underline">
            利用規約
          </Link>
          <Link to="/privacy" className="underline-offset-2 hover:underline">
            プライバシーポリシー
          </Link>
          {isAdmin && (
            <Link to="/admin" className="underline-offset-2 hover:underline">
              管理画面(運営者)
            </Link>
          )}
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
