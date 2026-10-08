import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// 利用規約とプライバシーポリシーへの同意。同意するまでアプリの画面には進まない(招待リンクは端末に保持されたまま)
export function ConsentScreen({ revised, loadError, onAgree, onRetry }) {
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleAgree() {
    setSaving(true)
    setError('')
    const result = await onAgree()
    setSaving(false)
    if (result?.error) setError('同意を記録できませんでした。通信状況を確かめて、もう一度お試しください')
  }

  return (
    <div className="min-h-svh flex items-center justify-center px-4 pt-safe pb-safe">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandMark size="sm" className="mb-2 text-sm" />
          <CardTitle>{revised ? '利用規約などを改定しました' : 'ご利用の前に'}</CardTitle>
          <CardDescription>利用規約とプライバシーポリシーをお読みいただき、同意のうえでご利用ください</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-sm">
            <Link to="/terms" className="underline">
              利用規約を読む
            </Link>
            <Link to="/privacy" className="underline">
              プライバシーポリシーを読む
            </Link>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            利用規約とプライバシーポリシーに同意します
          </label>
          {loadError && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
              <span>同意の記録を確認できませんでした。同意済みの場合は、再読み込みしてください</span>
              <Button size="sm" variant="outline" onClick={onRetry}>
                再読み込み
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleAgree} disabled={!checked || saving}>
            {saving ? '記録中...' : '同意して始める'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
