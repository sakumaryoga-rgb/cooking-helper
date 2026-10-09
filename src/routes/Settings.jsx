import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Link2, LogOut } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
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

function useMembers(groupId) {
  const [members, setMembers] = useState([])
  useEffect(() => {
    let cancelled = false
    supabase
      .from('group_members')
      .select('user_id, joined_at')
      .eq('group_id', groupId)
      .order('joined_at')
      .then(({ data }) => {
        if (!cancelled) setMembers(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [groupId])
  return members
}

// 設定(設計書 4 章): 家族グループ、招待、メンバー、アカウント、規約、バージョン。課金は枠だけ
export function Settings({ group, groups = [group], onSelectGroup, onGroupsChanged, email, userId }) {
  const members = useMembers(group.id)
  const navigate = useNavigate()
  const [newGroupName, setNewGroupName] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [houseMessage, setHouseMessage] = useState('')
  const [houseBusy, setHouseBusy] = useState(false)

  function switchTo(id) {
    onSelectGroup?.(id)
    navigate('/')
  }

  async function handleCreateHouse(e) {
    e.preventDefault()
    setHouseBusy(true)
    setHouseMessage('')
    const { data, error: rpcError } = await supabase.rpc('create_group', { group_name: newGroupName })
    setHouseBusy(false)
    if (rpcError || !data?.id) {
      setHouseMessage(rpcError?.message ?? '家を作れませんでした')
      return
    }
    setNewGroupName('')
    await onGroupsChanged?.(data.id)
    navigate('/')
  }

  async function handleJoinHouse(e) {
    e.preventDefault()
    const token = parseInviteToken(inviteInput)
    if (!token) {
      setHouseMessage('招待リンクをそのまま貼り付けてください')
      return
    }
    setHouseBusy(true)
    setHouseMessage('')
    const { data, error: rpcError } = await supabase.rpc('join_group_with_invite', { p_token: token })
    setHouseBusy(false)
    if (rpcError) {
      setHouseMessage(rpcError.message)
      return
    }
    if (!data?.id) {
      setHouseMessage('招待リンクが無効か、期限が切れています。グループのメンバーに新しい招待リンクを発行してもらってください')
      return
    }
    setInviteInput('')
    await onGroupsChanged?.(data.id)
    navigate('/')
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
        <CardHeader>
          <CardTitle className="text-base">家の切り替え</CardTitle>
          <CardDescription>参加している家を選ぶと、冷蔵庫・レシピ・調理の記録がその家のものに切り替わります</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1" aria-label="参加している家">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  aria-pressed={g.id === group.id}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm ${g.id === group.id ? 'border-primary bg-primary/15 font-medium' : ''}`}
                  onClick={() => switchTo(g.id)}
                  disabled={g.id === group.id}
                >
                  {g.name}
                  {g.id === group.id && <span className="text-xs">選択中</span>}
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={handleJoinHouse} className="flex gap-2">
            <Input aria-label="招待リンク" placeholder="招待リンクを貼り付けて参加" value={inviteInput} onChange={(e) => setInviteInput(e.target.value)} autoComplete="off" />
            <Button type="submit" variant="outline" disabled={houseBusy || !inviteInput.trim()}>
              参加
            </Button>
          </form>
          <form onSubmit={handleCreateHouse} className="flex gap-2">
            <Input aria-label="新しい家の名前" placeholder="新しい家の名前(例: 実家)" value={newGroupName} maxLength={40} onChange={(e) => setNewGroupName(e.target.value)} />
            <Button type="submit" variant="outline" disabled={houseBusy || !newGroupName.trim()}>
              作成
            </Button>
          </form>
          {houseMessage && <p className="text-sm text-destructive">{houseMessage}</p>}
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
          <CardDescription>このグループで冷蔵庫とレシピを共有しています</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-sm">
            {members.map((m, i) => (
              <li key={m.user_id} className="flex items-center justify-between">
                <span>{m.user_id === userId ? 'あなた' : `メンバー ${i + 1}`}</span>
                <span className="text-xs text-muted-foreground">{new Date(m.joined_at).toLocaleDateString('ja-JP')} 参加</span>
              </li>
            ))}
          </ul>
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
