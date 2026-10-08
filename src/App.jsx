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
import { Settings } from '@/routes/Settings'
import { Home } from '@/routes/Home'
import { Terms, Privacy } from '@/routes/Legal'
import { Contact } from '@/routes/Contact'
import { Admin } from '@/routes/Admin'
import { ConsentScreen } from '@/components/ConsentScreen'
import { useConsent } from '@/hooks/useConsent'
import { Layout } from '@/components/Layout'
import { UpdatePrompt } from '@/components/UpdatePrompt'
import { PreviewBanner } from '@/components/PreviewBanner'
import { BrandMark } from '@/components/BrandMark'
import { useTelemetry } from '@/hooks/useTelemetry'
import { capturePendingInvite } from '@/lib/invite'

function FullScreenLoader() {
  return (
    <div role="status" className="min-h-svh flex flex-col items-center justify-center gap-4">
      <BrandMark size="lg" className="flex-col text-lg" />
      <Loader2 className="size-5 animate-spin text-brand-tomato" />
      <span className="sr-only">読み込み中</span>
    </div>
  )
}

export default function App() {
  const { session, loading: sessionLoading } = useSession()
  const { group, loading: groupLoading, refresh: refreshGroup } = useGroup(session)
  const location = useLocation()
  const consent = useConsent(session?.user?.id ?? null)

  // 利用状況とエラーの記録(本番DBに接続するビルドで、ログイン中だけ)
  useTelemetry({
    userId: session?.user?.id ?? null,
    groupId: group?.id ?? null,
    ready: !sessionLoading && !groupLoading,
  })

  // 招待リンク(#invite=トークン)を開いた場合、未ログインでも後で使えるよう覚え、URL からは消す
  useEffect(() => {
    capturePendingInvite(location, (path) => window.history.replaceState(window.history.state, '', path))
  }, [location])

  if (sessionLoading) {
    return (
      <>
        <UpdatePrompt />
        <FullScreenLoader />
      </>
    )
  }

  return (
    <>
      <PreviewBanner />
      <UpdatePrompt />
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* 規約とポリシーは、ログイン前・同意前でも読めるようにする */}
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />

        {!session ? (
          <Route path="*" element={<Navigate to="/login" replace />} />
        ) : consent.loading ? (
          <Route path="*" element={<FullScreenLoader />} />
        ) : consent.needsConsent ? (
          <Route path="*" element={<ConsentScreen revised={consent.revised} loadError={consent.loadError} onAgree={consent.agree} onRetry={consent.retry} />} />
        ) : groupLoading ? (
          <Route path="*" element={<FullScreenLoader />} />
        ) : !group ? (
          <>
            <Route path="/onboarding" element={<Onboarding onGroupChanged={refreshGroup} />} />
            <Route path="*" element={<Navigate to="/onboarding" replace />} />
          </>
        ) : (
          <Route element={<Layout groupName={group.name} />}>
            <Route index element={<Home groupId={group.id} />} />
            <Route path="/fridge" element={<Fridge groupId={group.id} />} />
            <Route path="/recipes" element={<Recipes groupId={group.id} />} />
            <Route path="/recipes/new" element={<RecipeNew groupId={group.id} userId={session.user.id} />} />
            <Route path="/recipes/:id" element={<RecipeDetail groupId={group.id} />} />
            <Route path="/settings" element={<Settings group={group} email={session.user.email} userId={session.user.id} />} />
            <Route path="/group" element={<Navigate to="/settings" replace />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </>
  )
}
