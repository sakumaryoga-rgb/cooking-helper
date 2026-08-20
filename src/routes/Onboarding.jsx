import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

export function Onboarding({ onGroupChanged }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const codeFromUrl = searchParams.get('code')
  const codeFromStorage = typeof window !== 'undefined' ? localStorage.getItem('pendingInviteCode') : null
  const initialCode = (codeFromUrl || codeFromStorage || '').toUpperCase()

  const [mode, setMode] = useState(initialCode ? 'join' : 'create')
  const [groupName, setGroupName] = useState('')
  const [joinCode, setJoinCode] = useState(initialCode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (initialCode) {
      localStorage.removeItem('pendingInviteCode')
    }
    // 初回マウント時のみ実行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('create_group', { group_name: groupName })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await onGroupChanged()
    navigate('/fridge', { replace: true })
  }

  async function handleJoin(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('join_group', { join_code: joinCode })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await onGroupChanged()
    navigate('/fridge', { replace: true })
  }

  return (
    <div className="min-h-svh flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>グループを作成 / 参加</CardTitle>
          <CardDescription>冷蔵庫とレシピを共有する世帯・グループを設定します</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'create' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setMode('create')}
            >
              新しく作成
            </Button>
            <Button
              type="button"
              variant={mode === 'join' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setMode('join')}
            >
              招待コードで参加
            </Button>
          </div>

          {mode === 'create' ? (
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="group-name">グループ名</Label>
                <Input
                  id="group-name"
                  required
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="例: 山田家"
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" disabled={saving}>
                {saving ? '作成中...' : 'グループを作成'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="join-code">招待コード</Label>
                <Input
                  id="join-code"
                  required
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="例: ABCD1234"
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" disabled={saving}>
                {saving ? '参加中...' : 'グループに参加'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
