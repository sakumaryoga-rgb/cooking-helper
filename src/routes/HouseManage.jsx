import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Crown, DoorOpen, Pencil, Trash2, UserMinus, Users } from 'lucide-react'
import { HouseBadge, houseLook } from '@/components/HouseSwitcher'
import { memberLabel, useHouseMembers } from '@/hooks/useHouseMembers'
import { supabase } from '@/supabaseClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

function RoleChip({ owner }) {
  return owner ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
      <Crown className="size-3" />
      管理者
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">メンバー</span>
  )
}

// 確認ダイアログ(操作の前に必ず出す)
function Confirm({ open, title, description, confirmLabel, destructive, busy, onConfirm, onCancel, children, canConfirm = true }) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            やめる
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy || !canConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// 家の管理(設定 → わたしの家 → 各カードの「管理」)。権限の判断はすべて DB の RPC が行い、画面は表示を切り替えるだけ
export function HouseManage({ groups, userId, onGroupsChanged }) {
  const { id } = useParams()
  const house = groups.find((g) => g.id === id)
  if (!house) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">この家は見つかりません。脱退したか、削除された可能性があります</p>
        <Link to="/settings" className="text-sm underline underline-offset-2">
          設定に戻る
        </Link>
      </div>
    )
  }
  return <HouseManageBody key={house.id} house={house} userId={userId} onGroupsChanged={onGroupsChanged} />
}

function HouseManageBody({ house, userId, onGroupsChanged }) {
  const navigate = useNavigate()
  const { members, loading, reload } = useHouseMembers(house.id)
  const me = members.find((m) => m.user_id === userId)
  const isOwner = me?.role === 'owner'
  const { tint } = houseLook(house.id)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [nickname, setNickname] = useState(null) // 編集中だけ文字列
  const [houseName, setHouseName] = useState(null)
  const [confirm, setConfirm] = useState(null) // { kind, member? }
  const [deleteName, setDeleteName] = useState('')

  async function run(fn, args, after) {
    setBusy(true)
    setMessage('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) {
      setMessage(error.message)
      return false
    }
    await after?.()
    return true
  }

  async function saveNickname(e) {
    e.preventDefault()
    if (await run('set_my_house_display_name', { p_group_id: house.id, p_name: nickname }, reload)) setNickname(null)
  }

  async function saveHouseName(e) {
    e.preventDefault()
    if (await run('rename_group', { p_group_id: house.id, p_name: houseName }, () => onGroupsChanged?.(null, { silent: true })))
      setHouseName(null)
  }

  // 脱退・削除のあとは家の一覧を読み直す(選択中の家なら別の家へ。家がなくなれば参加画面)
  async function afterGone() {
    await onGroupsChanged?.(null, { silent: true })
    navigate('/settings', { replace: true })
  }

  // 確認ダイアログで「はい」を押したとき。失敗したらダイアログを閉じて理由を出す
  async function onConfirm() {
    const c = confirm
    if (c.kind === 'leave') await run('leave_group', { p_group_id: house.id }, afterGone)
    if (c.kind === 'delete') await run('delete_group', { p_group_id: house.id, p_confirm_name: deleteName }, afterGone)
    if (c.kind === 'remove') await run('remove_group_member', { p_group_id: house.id, p_user_id: c.member.user_id }, reload)
    if (c.kind === 'transfer') await run('transfer_group_owner', { p_group_id: house.id, p_new_owner: c.member.user_id }, reload)
    setConfirm(null)
  }

  const label = (m) => memberLabel(m, members.indexOf(m), userId)

  return (
    <div className="flex flex-col gap-4">
      <Link to="/settings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        設定
      </Link>

      {/* 家の表札 */}
      <section className={`flex flex-col items-center gap-2 rounded-3xl ${tint} px-4 py-6 text-center`}>
        <HouseBadge id={house.id} className="size-16 rounded-2xl" />
        {houseName === null ? (
          <h1 className="flex items-center gap-1.5 text-xl font-semibold">
            {house.name}
            {isOwner && (
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
                aria-label="家の名前を変える"
                onClick={() => setHouseName(house.name)}
              >
                <Pencil className="size-4" />
              </button>
            )}
          </h1>
        ) : (
          <form onSubmit={saveHouseName} className="flex w-full max-w-xs gap-2">
            <Input aria-label="家の名前" value={houseName} maxLength={40} onChange={(e) => setHouseName(e.target.value)} autoFocus />
            <Button type="submit" disabled={busy || !houseName.trim()}>
              保存
            </Button>
          </form>
        )}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" />
          {loading ? '…' : `${members.length}人が住んでいます`}
          {me && <RoleChip owner={isOwner} />}
        </p>
      </section>

      {message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      )}

      {/* 住人 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">住んでいる人</CardTitle>
          <CardDescription>メールアドレスはほかの人に表示されません。呼び名はこの家の中だけで使われます</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-border">
            {members.map((m) => {
              const mine = m.user_id === userId
              return (
                <li key={m.user_id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${m.role === 'owner' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {label(m).slice(0, 1)}
                    </span>
                    <span className="truncate text-sm font-medium">{label(m)}</span>
                    {mine && <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">あなた</span>}
                    {m.role === 'owner' && <Crown className="size-4 shrink-0 text-amber-500" aria-label="管理者" />}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(m.joined_at).toLocaleDateString('ja-JP')} から</span>
                  {isOwner && !mine && (
                    <span className="flex w-full justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'transfer', member: m })}>
                        <Crown className="size-3.5" />
                        管理者にする
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirm({ kind: 'remove', member: m })}>
                        <UserMinus className="size-3.5" />
                        退出させる
                      </Button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>

          {nickname === null ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setNickname(me?.display_name ?? '')} disabled={!me}>
              <Pencil className="size-3.5" />
              自分の呼び名を変える
            </Button>
          ) : (
            <form onSubmit={saveNickname} className="mt-3 flex gap-2">
              <Input aria-label="自分の呼び名" placeholder="例: パパ、はなこ(空欄で解除)" value={nickname} maxLength={20} onChange={(e) => setNickname(e.target.value)} autoFocus />
              <Button type="submit" disabled={busy}>
                保存
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* 脱退 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">この家から脱退</CardTitle>
          <CardDescription>
            {isOwner
              ? '管理者は、先にほかの人を「管理者にする」と脱退できます。ほかに住んでいる人がいない場合は、下の「家を削除」を使ってください'
              : 'この家だけから抜けます。アカウントとほかの家はそのままです。もう一度入るには招待リンクが必要です'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" disabled={busy || !me || isOwner} onClick={() => setConfirm({ kind: 'leave' })}>
            <DoorOpen className="size-4" />
            この家から脱退
          </Button>
        </CardContent>
      </Card>

      {/* 管理者メニュー */}
      {isOwner && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">家を削除(管理者のみ)</CardTitle>
            <CardDescription>
              この家の冷蔵庫・在庫・レシピ・作った記録・招待リンクをすべて消し、住んでいる人全員がこの家に入れなくなります。元に戻せません。
              アカウントとほかの家は消えません
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" className="w-full" disabled={busy} onClick={() => { setDeleteName(''); setConfirm({ kind: 'delete' }) }}>
              <Trash2 className="size-4" />
              家を削除
            </Button>
          </CardContent>
        </Card>
      )}

      <Confirm
        open={confirm?.kind === 'leave'}
        title={`「${house.name}」から脱退しますか?`}
        description="この家の冷蔵庫やレシピが見られなくなります。家とほかの人のデータはそのまま残ります。"
        confirmLabel="脱退する"
        destructive
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setConfirm(null)}
      />
      <Confirm
        open={confirm?.kind === 'remove'}
        title={`${confirm?.member ? label(confirm.member) : ''} を退出させますか?`}
        description="すぐにこの家のデータが見られなくなります。この家の招待リンクも無効になるので、必要なら発行し直してください。"
        confirmLabel="退出させる"
        destructive
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setConfirm(null)}
      />
      <Confirm
        open={confirm?.kind === 'transfer'}
        title={`${confirm?.member ? label(confirm.member) : ''} を管理者にしますか?`}
        description="管理者は1人だけです。あなたはメンバーになり、メンバーの管理や家の削除ができなくなります。"
        confirmLabel="管理者を譲る"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setConfirm(null)}
      />
      <Confirm
        open={confirm?.kind === 'delete'}
        title={`「${house.name}」を削除しますか?`}
        description="家と、その家の冷蔵庫・在庫・レシピ・作った記録・招待リンクがすべて消えます。元に戻せません。アカウントの削除ではありません。"
        confirmLabel="完全に削除する"
        destructive
        busy={busy}
        canConfirm={deleteName.trim() === house.name}
        onConfirm={onConfirm}
        onCancel={() => setConfirm(null)}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          確認のため、家の名前「{house.name}」を入力してください
          <Input aria-label="削除する家の名前" value={deleteName} onChange={(e) => setDeleteName(e.target.value)} autoComplete="off" />
        </label>
      </Confirm>
    </div>
  )
}
