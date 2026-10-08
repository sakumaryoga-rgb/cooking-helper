import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseInviteToken, takePendingInvite } from '@/lib/invite'
import { supabase } from '@/supabaseClient'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

export function Onboarding({ onGroupChanged }) {
  const navigate = useNavigate()

  // 招待リンクから来た場合は、そのトークンで参加する画面を最初に出す
  const [pending] = useState(() => takePendingInvite())
  const [mode, setMode] = useState(pending.token ? 'join' : 'create')
  const [groupName, setGroupName] = useState('')
  const [inviteInput, setInviteInput] = useState(pending.token ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(
    pending.legacy ? 'この招待リンクは古い形式のため使えません。グループのメンバーに新しい招待リンクを発行してもらってください' : ''
  )

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
      setError('招待リンクが無効か、期限が切れています。グループのメンバーに新しい招待リンクを発行してもらってください')
      return
    }
    await onGroupChanged()
    navigate('/fridge', { replace: true })
  }

  return (
    <div className="min-h-svh flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandMark size="sm" className="mb-2 text-sm" />
          <CardTitle>グループを作成 / 参加</CardTitle>
          <CardDescription>COOKDOOR で冷蔵庫とレシピを共有する世帯・グループを設定します</CardDescription>
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
              招待リンクで参加
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
                <Label htmlFor="invite-link">招待リンク</Label>
                <Input
                  id="invite-link"
                  required
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  placeholder="https://cookdoor.app/onboarding#invite=..."
                  autoComplete="off"
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
