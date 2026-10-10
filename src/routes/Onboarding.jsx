import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, HousePlus, KeyRound, Refrigerator, Users } from 'lucide-react'
import { parseInviteToken } from '@/lib/invite'
import { supabase } from '@/supabaseClient'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// 入口の家のイラスト。屋根はトマト、扉はブランドの黄色。開いた扉からフライパンがのぞく
function HouseArt() {
  return (
    <svg viewBox="0 0 160 120" className="h-32 w-auto drop-shadow-sm" aria-hidden="true">
      <ellipse cx="80" cy="112" rx="62" ry="6" fill="#3b2a1c" opacity="0.08" />
      <rect x="104" y="22" width="12" height="26" rx="2" fill="#c9b8a6" />
      <path d="M80 10 L144 58 L16 58 Z" fill="#e53d26" stroke="#3b2a1c" strokeWidth="3" strokeLinejoin="round" />
      <rect x="28" y="56" width="104" height="54" rx="4" fill="#fffdf7" stroke="#3b2a1c" strokeWidth="3" />
      <rect x="40" y="68" width="22" height="20" rx="3" fill="#fed712" opacity="0.35" stroke="#3b2a1c" strokeWidth="2.5" />
      <path d="M51 68 V88 M40 78 H62" stroke="#3b2a1c" strokeWidth="2" />
      <rect x="86" y="66" width="30" height="44" rx="3" fill="#3b2a1c" />
      <circle cx="101" cy="92" r="6" fill="#f2eae3" />
      <rect x="106" y="90" width="8" height="3" rx="1.5" fill="#f2eae3" />
      <g className="origin-[86px_88px] animate-[door-open_1.2s_ease-out_0.3s_both]">
        <rect x="86" y="66" width="30" height="44" rx="3" fill="#fed712" stroke="#3b2a1c" strokeWidth="3" />
        <circle cx="110" cy="89" r="2.6" fill="#3b2a1c" />
      </g>
    </svg>
  )
}

const FEATURES = [
  { Icon: Refrigerator, label: '冷蔵庫を記録' },
  { Icon: BookOpen, label: '作れるレシピ' },
  { Icon: Users, label: '家族と共有' },
]

function ChoiceCard({ active, Icon, title, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 flex-col items-center gap-1.5 rounded-2xl border-2 px-3 py-4 text-center transition-all ${
        active ? 'border-[#3b2a1c] bg-primary text-primary-foreground shadow-[0_3px_0_#3b2a1c]' : 'border-border bg-card hover:-translate-y-0.5 hover:border-[#3b2a1c]/40'
      }`}
    >
      <Icon className="size-7" strokeWidth={2.2} />
      <span className="text-sm font-bold">{title}</span>
      <span className={`text-[11px] leading-tight ${active ? 'opacity-80' : 'text-muted-foreground'}`}>{sub}</span>
    </button>
  )
}

export function Onboarding({ onGroupChanged, notice }) {
  const navigate = useNavigate()

  // 開いた招待リンクは App(usePendingInvite)がログイン後に自動で処理する。失敗したときは理由を出し、
  // 招待リンクを貼り付けて参加し直せるようにする
  const [mode, setMode] = useState(notice?.kind === 'error' ? 'join' : 'create')
  const [groupName, setGroupName] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(notice?.kind === 'error' ? notice.text : '')

  function choose(next) {
    setMode(next)
    setError('')
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { data: created, error: rpcError } = await supabase.rpc('create_group', { group_name: groupName })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await onGroupChanged(created?.id)
    navigate('/fridge', { replace: true })
  }

  async function handleJoin(e) {
    e.preventDefault()
    setError('')
    const token = parseInviteToken(inviteInput)
    if (!token) {
      setError('招待リンクをそのまま貼り付けてください')
      return
    }
    setSaving(true)
    const { data, error: rpcError } = await supabase.rpc('join_group_with_invite', { p_token: token })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    if (!data?.id) {
      setError('招待リンクが無効か、期限が切れています。家族に新しい招待リンクを発行してもらってください')
      return
    }
    await onGroupChanged(data.id)
    navigate('/fridge', { replace: true })
  }

  return (
    <div className="min-h-svh bg-[radial-gradient(circle_at_50%_0%,#fff3b0_0%,transparent_60%)] px-4 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-5 py-8">
        <BrandMark size="sm" className="self-center text-sm" />

        <section className="flex flex-col items-center gap-3 text-center">
          <HouseArt />
          <h1 className="text-2xl font-bold tracking-tight">ようこそ、COOKDOOR へ</h1>
          <p className="text-sm text-muted-foreground">
            まずは、冷蔵庫とレシピをしまっておく
            <br />
            「家」を用意しましょう
          </p>
          <ul className="flex flex-wrap justify-center gap-2 pt-1">
            {FEATURES.map(({ Icon, label }) => (
              <li key={label} className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-border">
                <Icon className="size-3.5" />
                {label}
              </li>
            ))}
          </ul>
        </section>

        <div className="flex gap-3" role="group" aria-label="はじめ方">
          <ChoiceCard active={mode === 'create'} Icon={HousePlus} title="家を建てる" sub="はじめて使う" onClick={() => choose('create')} />
          <ChoiceCard active={mode === 'join'} Icon={KeyRound} title="招待で入る" sub="家族から招待された" onClick={() => choose('join')} />
        </div>

        <div className="rounded-3xl border-2 border-[#3b2a1c] bg-card p-4 shadow-[0_4px_0_#3b2a1c]">
          {mode === 'create' ? (
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="group-name">家の名前</Label>
                <Input
                  id="group-name"
                  required
                  maxLength={40}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="例: 山田家、実家"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">あとから変更したり、家族を招待したりできます</p>
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" size="lg" disabled={saving || !groupName.trim()}>
                <HousePlus />
                {saving ? '建てています...' : 'この名前で家を建てる'}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                家族から招待リンクをもらっている場合は、家を建てずに
                <button type="button" className="font-semibold text-foreground underline underline-offset-2" onClick={() => choose('join')}>
                  招待で入る
                </button>
                を選んでください
              </p>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-link">招待リンク</Label>
                <Input
                  id="invite-link"
                  required
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  placeholder="もらった招待リンクを貼り付け"
                  autoComplete="off"
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" size="lg" disabled={saving}>
                <KeyRound />
                {saving ? '入っています...' : '家に入る'}
              </Button>
              <p className="rounded-xl bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                招待リンクをもう一度開いても入れます。ログインのメールを別のアプリやブラウザで開くと、招待が引き継がれないことがあります。
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
