import { useRef, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { APP_VERSION } from '@/lib/appVersion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const CONTACT_CATEGORIES = [
  { id: 'question', label: '使い方の質問' },
  { id: 'bug', label: '不具合の報告' },
  { id: 'request', label: '機能の要望' },
  { id: 'account', label: 'アカウント・データの削除など' },
  { id: 'other', label: 'その他' },
]

const RESULT_MESSAGES = {
  rate_limited: '短い時間に続けて送信されたため、受け付けられませんでした。しばらくしてからお試しください',
  duplicate: '同じ内容のお問い合わせを受け付け済みです',
}

function validate({ body, email }) {
  const text = body.trim()
  if (text.length < 10) return '内容は10文字以上で入力してください'
  if (text.length > 2000) return '内容は2000文字以内で入力してください'
  if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return '返信先のメールアドレスの形式が正しくありません'
  return ''
}

// お問い合わせ(送信は submit_contact RPC。送った内容はアプリからは読めない)
export function Contact() {
  const openedAt = useRef(Date.now())
  const [category, setCategory] = useState('question')
  const [body, setBody] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // ボット対策の隠し欄(人は入力しない)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const message = validate({ body, email })
    if (message) {
      setError(message)
      return
    }
    setSending(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('submit_contact', {
      p_category: category,
      p_body: body.trim(),
      p_reply_email: email.trim() || null,
      p_app_version: APP_VERSION,
      p_honeypot: website,
      p_elapsed_ms: Date.now() - openedAt.current,
    })
    setSending(false)
    if (rpcError) {
      setError('送信できませんでした。通信状況を確かめて、もう一度お試しください')
      return
    }
    if (data !== 'ok') {
      setError(RESULT_MESSAGES[data] ?? '送信できませんでした')
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-medium">お問い合わせ</h1>
        <p className="text-sm">お問い合わせを受け付けました。返信先を入力された場合は、そのアドレスにお返事します。</p>
      </div>
    )
  }

  return (
    // 入力チェックは日本語の案内を出すためにアプリ側で行う(ブラウザ標準の検証は使わない)
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">お問い合わせ</h1>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-category">種類</Label>
        <select id="contact-category" className="h-9 rounded-md border bg-background px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CONTACT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-body">内容(10〜2000文字)</Label>
        <textarea
          id="contact-body"
          className="min-h-36 rounded-md border bg-background px-3 py-2 text-sm"
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="self-end text-xs text-muted-foreground">{body.trim().length} / 2000</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-email">返信先のメールアドレス(任意)</Label>
        <Input id="contact-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="text-xs text-muted-foreground">返信先は、受付から90日を過ぎたら削除します(お返事のためだけに使います)</p>
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={sending}>
        {sending ? '送信中...' : '送信する'}
      </Button>
    </form>
  )
}
