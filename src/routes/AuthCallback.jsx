import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useSession } from '@/hooks/useSession'

export function AuthCallback() {
  const { session, loading } = useSession()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading) {
      navigate(session ? '/' : '/login', { replace: true })
    }
  }, [loading, session, navigate])

  return (
    <div className="min-h-svh flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      ログイン処理中...
    </div>
  )
}
