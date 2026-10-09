import { useState } from 'react'
import { takeSessionExpired } from '@/lib/sessionNotice'
import { supabase } from '@/supabaseClient'
import { DB_ENABLED } from '@/lib/runtimeEnv'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

export function Login() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [errorMessage, setErrorMessage] = useState('')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [expired] = useState(() => takeSessionExpired())

  // メールに届いた6桁のコードでログインする(リンクが別のブラウザで開いてしまう場合でも、この画面のままログインできる)
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

  return (
    <div className="min-h-svh flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <BrandMark />
          </CardTitle>
          <CardDescription>メールアドレスにログイン用のリンクを送ります</CardDescription>
          {expired && <p className="text-sm text-destructive">ログインの有効期限が切れました。もう一度ログインしてください</p>}
          <p className="text-xs text-muted-foreground">
            Safari、Chrome、ホーム画面に追加したアプリは、それぞれ別にログインが必要です。同じメールアドレスでログインすれば、同じ家とデータが表示されます。
          </p>
        </CardHeader>
        <CardContent>
          {!DB_ENABLED ? (
            <p className="text-sm text-muted-foreground">
              プレビュー環境では本番のデータベースに接続しないため、ログインできません。
            </p>
          ) : status === 'sent' ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                {email} 宛にログイン用のメールを送りました。メールのリンクを開くとログインできます。
              </p>
              <form onSubmit={handleVerify} className="flex flex-col gap-2">
                <Label htmlFor="otp">メールに6桁のコードがある場合は、ここに入力してもログインできます</Label>
                <div className="flex gap-2">
                  <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  <Button type="submit" disabled={verifying || code.length !== 6}>
                    ログイン
                  </Button>
                </div>
              </form>
              {errorMessage && <p className="text-destructive">{errorMessage}</p>}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              </div>
              {status === 'error' && <p className="text-destructive text-sm">{errorMessage}</p>}
              <Button type="submit" disabled={status === 'sending'}>
                {status === 'sending' ? '送信中...' : 'ログインリンクを送る'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
