import { useState } from 'react'
import { MailCheck, Send } from 'lucide-react'
import { takeSessionExpired } from '@/lib/sessionNotice'
import { supabase } from '@/supabaseClient'
import { DB_ENABLED } from '@/lib/runtimeEnv'
import { BrandMark } from '@/components/BrandMark'
import { FeatureChips, HouseArt } from '@/components/HouseArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function Login() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [errorMessage, setErrorMessage] = useState('')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [expired] = useState(() => takeSessionExpired())

  // メールに届いたコードでログインする(リンクが別のブラウザで開いてしまう場合でも、この画面のままログインできる)。
  // コードの桁数は Supabase の設定(Email OTP Length、6〜10桁)による
  async function handleVerify(e) {
    e.preventDefault()
    setVerifying(true)
    setErrorMessage('')
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    setVerifying(false)
    if (error) setErrorMessage('コードが正しくないか、期限が切れています。もう一度ログインリンクを送ってください')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus('sending')
    setErrorMessage('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
      return
    }
    setStatus('sent')
  }

  const sent = status === 'sent'

  return (
    <div className="min-h-svh bg-[radial-gradient(circle_at_50%_0%,#fff3b0_0%,transparent_60%)] px-4 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-5 py-8">
        <BrandMark size="sm" className="self-center text-sm" />

        <section className="flex flex-col items-center gap-3 text-center">
          {/* メールを送ると扉が開く */}
          <HouseArt key={sent ? 'open' : 'closed'} open={sent} floating />
          <h1 className="text-2xl font-bold leading-snug tracking-tight">
            冷蔵庫の扉をあけたら、
            <br />
            今日のごはんが見つかる
          </h1>
          <p className="text-sm text-muted-foreground">
            家にある食材から、
            <br />
            いま作れるレシピがすぐわかります
          </p>
          <FeatureChips />
        </section>

        <div className="rounded-3xl border-2 border-[#3b2a1c] bg-card p-4 shadow-[0_4px_0_#3b2a1c]">
          {expired && <p className="mb-3 text-sm text-destructive">ログインの有効期限が切れました。もう一度ログインしてください</p>}
          {!DB_ENABLED ? (
            <p className="text-sm text-muted-foreground">
              プレビュー環境では本番のデータベースに接続しないため、ログインできません。
            </p>
          ) : sent ? (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true">
                  <MailCheck className="size-5" strokeWidth={2.2} />
                </span>
                <div>
                  <p className="font-bold">メールを送りました</p>
                  <p className="break-all text-muted-foreground">
                    {email} 宛にログイン用のメールを送りました。メールのリンクを開くとログインできます。
                  </p>
                </div>
              </div>
              <form onSubmit={handleVerify} className="flex flex-col gap-2 rounded-2xl bg-muted/70 p-3">
                <Label htmlFor="otp">メールに書かれたコード(数字)を入力しても、この画面のままログインできます</Label>
                <div className="flex gap-2">
                  <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="bg-card text-center font-mono tracking-[0.3em]" />
                  <Button type="submit" disabled={verifying || code.length < 6}>
                    ログイン
                  </Button>
                </div>
              </form>
              {errorMessage && <p className="text-destructive">{errorMessage}</p>}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <p className="text-[11px] text-muted-foreground">パスワード不要。届いたメールのリンクかコードで入れます</p>
              </div>
              {status === 'error' && <p className="text-destructive text-sm">{errorMessage}</p>}
              <Button type="submit" size="lg" disabled={status === 'sending'}>
                <Send />
                {status === 'sending' ? '送信中...' : 'ログインリンクを送る'}
              </Button>
            </form>
          )}
        </div>

        <p className="px-2 text-center text-[11px] leading-relaxed text-muted-foreground">
          Safari、Chrome、ホーム画面に追加したアプリは、それぞれ別にログインが必要です。同じメールアドレスでログインすれば、同じ家とデータが表示されます。
        </p>
      </div>
    </div>
  )
}
