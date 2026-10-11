import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, FileText, ShieldCheck } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { HouseArt } from '@/components/HouseArt'
import { Button } from '@/components/ui/button'

// 利用規約とプライバシーポリシーへの同意。初めて開いたとき(ログインの前)と、改定したときに出す。
// 同意するまでアプリの画面には進まない(招待リンクは端末に保持されたまま)
export function ConsentScreen({ revised, onAgree }) {
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleAgree() {
    setSaving(true)
    await onAgree()
    setSaving(false)
  }

  const doc = (to, Icon, label) => (
    <Link to={to} className="flex items-center gap-3 rounded-2xl border bg-background px-3 py-3 text-sm font-medium hover:bg-muted">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Icon className="size-4" />
      </span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  )

  return (
    <div className="min-h-svh bg-[radial-gradient(circle_at_50%_0%,#fff3b0_0%,transparent_60%)] px-4 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-5 py-8">
        <BrandMark size="sm" className="self-center text-sm" />
        <section className="flex flex-col items-center gap-3 text-center">
          <HouseArt open={false} floating />
          <h1 className="text-2xl font-bold leading-snug tracking-tight">{revised ? '利用規約などを改定しました' : 'ようこそ、COOKDOOR へ'}</h1>
          <p className="text-sm text-muted-foreground">
            {revised ? '新しい内容をご確認のうえ、同意してください' : '扉を開ける前に、利用規約とプライバシーポリシーをご確認ください'}
          </p>
        </section>

        <div className="flex flex-col gap-3 rounded-3xl border-2 border-[#3b2a1c] bg-card p-4 shadow-[0_4px_0_#3b2a1c]">
          {doc('/terms', FileText, '利用規約を読む')}
          {doc('/privacy', ShieldCheck, 'プライバシーポリシーを読む')}
          <label className="flex items-start gap-2.5 rounded-2xl bg-muted/60 px-3 py-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 accent-[#3b2a1c]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            利用規約とプライバシーポリシーの内容を確認し、同意します
          </label>
          <Button size="lg" onClick={handleAgree} disabled={!checked || saving}>
            同意して始める
          </Button>
        </div>
      </div>
    </div>
  )
}
