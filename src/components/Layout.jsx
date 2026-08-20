import { NavLink, Outlet } from 'react-router-dom'
import { Refrigerator, ChefHat, Users, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/supabaseClient'
import { AdSlot } from '@/components/AdSlot'

const NAV_ITEMS = [
  { to: '/fridge', label: '冷蔵庫', icon: Refrigerator },
  { to: '/recipes', label: 'レシピ', icon: ChefHat },
  { to: '/group', label: 'グループ', icon: Users },
]

export function Layout({ groupName }) {
  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-svh flex flex-col bg-background">
      <header className="border-b sticky top-0 bg-background/80 backdrop-blur z-10">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-medium text-sm truncate">{groupName ?? '料理ヘルパー'}</span>
          <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="サインアウト">
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-4 pb-24">
        <Outlet />
        <AdSlot />
      </main>

      <nav className="border-t bg-background/80 backdrop-blur fixed bottom-0 inset-x-0 z-10">
        <div className="max-w-lg mx-auto grid grid-cols-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-xs ${
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                }`
              }
            >
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
