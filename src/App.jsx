import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useGroup } from '@/hooks/useGroup'
import { Login } from '@/routes/Login'
import { AuthCallback } from '@/routes/AuthCallback'
import { Onboarding } from '@/routes/Onboarding'
import { Fridge } from '@/routes/Fridge'
import { Recipes } from '@/routes/Recipes'
import { RecipeNew } from '@/routes/RecipeNew'
import { RecipeDetail } from '@/routes/RecipeDetail'
import { GroupSettings } from '@/routes/GroupSettings'
import { Layout } from '@/components/Layout'

function FullScreenLoader() {
  return (
    <div className="min-h-svh flex items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export default function App() {
  const { session, loading: sessionLoading } = useSession()
  const { group, loading: groupLoading, refresh: refreshGroup } = useGroup(session)
  const location = useLocation()

  // 招待リンク (?code=XXXX) を踏んだ場合、未ログインでも後で使えるようコードを覚えておく
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('code')
    if (code) {
      localStorage.setItem('pendingInviteCode', code)
    }
  }, [location.search])

  if (sessionLoading) return <FullScreenLoader />

  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />

      {!session ? (
        <Route path="*" element={<Navigate to="/login" replace />} />
      ) : groupLoading ? (
        <Route path="*" element={<FullScreenLoader />} />
      ) : !group ? (
        <>
          <Route path="/onboarding" element={<Onboarding onGroupChanged={refreshGroup} />} />
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </>
      ) : (
        <Route element={<Layout groupName={group.name} />}>
          <Route index element={<Navigate to="/fridge" replace />} />
          <Route path="/fridge" element={<Fridge groupId={group.id} />} />
          <Route path="/recipes" element={<Recipes groupId={group.id} />} />
          <Route path="/recipes/new" element={<RecipeNew groupId={group.id} userId={session.user.id} />} />
          <Route path="/recipes/:id" element={<RecipeDetail groupId={group.id} />} />
          <Route path="/group" element={<GroupSettings group={group} />} />
          <Route path="*" element={<Navigate to="/fridge" replace />} />
        </Route>
      )}
    </Routes>
  )
}
