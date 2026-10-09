import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Home, ChefHat, Refrigerator, Settings } from 'lucide-react'
import { AdSlot } from '@/components/AdSlot'
import { BrandMark } from '@/components/BrandMark'
import { HouseBadge } from '@/components/HouseSwitcher'
import { KitchenDataProvider } from '@/components/KitchenDataProvider'
import { APP_NAME } from '@/lib/brand'

// 下部タブ4つ(設計書 4 章)。親指が届く下側に置き、iPhone の安全領域の分だけ余白を足す
const NAV_ITEMS = [
  { to: '/', label: 'ホーム', icon: Home, end: true },
  { to: '/recipes', label: 'レシピ', icon: ChefHat },
  { to: '/fridge', label: '冷蔵庫', icon: Refrigerator },
  { to: '/settings', label: '設定', icon: Settings },
]

export function Layout({ groupId, groupName, notice, onDismissNotice }) {
  return (
    <div className="min-h-svh flex flex-col bg-background">
      <header className="pt-safe border-b sticky top-0 bg-background/90 backdrop-blur z-10">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center">
          <span className="flex min-w-0 items-center gap-2">
            <BrandMark size="sm" showName={false} />
            {groupId && <HouseBadge id={groupId} className="size-6 rounded-lg" />}
            <span className="font-medium text-sm truncate" aria-label="選択中の家">{groupName ?? APP_NAME}</span>
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
        {notice && (
          <div
            role="status"
            className={`mb-4 flex items-start justify-between gap-2 rounded-lg px-3 py-2 text-sm ${notice.kind === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/20'}`}
          >
            <span>{notice.text}</span>
            <button type="button" className="shrink-0 text-xs underline" onClick={onDismissNotice}>
              閉じる
            </button>
          </div>
        )}
        <Suspense fallback={<p className="text-sm text-muted-foreground">読み込み中...</p>}>
          {groupId ? (
            <KitchenDataProvider groupId={groupId}>
              <Outlet />
            </KitchenDataProvider>
          ) : (
            <Outlet />
          )}
        </Suspense>
        <AdSlot />
      </main>

      <nav className="pb-safe border-t bg-background/95 backdrop-blur fixed bottom-0 inset-x-0 z-20" aria-label="メイン">
        <div className="max-w-lg mx-auto grid grid-cols-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex h-15 flex-col items-center justify-center gap-1 text-xs ${
                  isActive ? 'text-foreground font-medium' : 'text-muted-foreground'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full ${isActive ? 'bg-primary text-primary-foreground' : ''}`}>
                    <Icon className="size-5" />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
