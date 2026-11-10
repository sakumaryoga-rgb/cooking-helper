import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/hooks/useSession'
import { APP_NAME } from '@/lib/brand'
import { CookingLoader } from '@/components/CookingLoader'

export function AuthCallback() {
  const { session, loading } = useSession()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading) {
      navigate(session ? '/' : '/login', { replace: true })
    }
  }, [loading, session, navigate])

  return (
    <CookingLoader className="min-h-svh justify-center" label={`${APP_NAME} にログインしています...`} />
  )
}
