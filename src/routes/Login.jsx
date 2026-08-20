import { useState } from 'react'
import { supabase } from '@/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

export function Login() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [errorMessage, setErrorMessage] = useState('')

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
          <CardTitle>お料理ヘルパー</CardTitle>
          <CardDescription>メールアドレスにログイン用のリンクを送ります</CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'sent' ? (
            <p className="text-sm text-muted-foreground">
              {email} 宛にログインリンクを送信しました。メールを確認してください。
            </p>
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
