import { RefreshCw, WifiOff } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { HouseBadge } from '@/components/HouseSwitcher'
import { Button } from '@/components/ui/button'
import { getLoginMemory } from '@/lib/loginMemory'

function Frame({ children }) {
  return (
    <div className="min-h-svh bg-[radial-gradient(circle_at_50%_0%,#fff3b0_0%,transparent_60%)] px-4 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-5 py-10">
        <BrandMark size="sm" className="self-center text-sm" />
        {children}
      </div>
    </div>
  )
}

// 所属している家の一覧(タップで入る)
export function HouseList({ houses, onSelect, currentId, currentLabel = '前回', disabled = false }) {
  return (
    <ul className="flex flex-col gap-2">
      {houses.map((h) => (
        <li key={h.id}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect?.(h.id)}
            className={`flex w-full items-center gap-3 rounded-2xl border-2 bg-card px-3 py-3 text-left transition-all ${
              h.id === currentId ? 'border-[#3b2a1c] shadow-[0_3px_0_#3b2a1c]' : 'border-border hover:-translate-y-0.5 hover:border-[#3b2a1c]/40'
            } disabled:opacity-60`}
          >
            <HouseBadge id={h.id} className="size-10" />
            <span className="flex-1 truncate text-base font-bold">{h.name}</span>
            {h.id === currentId && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{currentLabel}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

// ログイン直後、家が2つ以上あってこの端末でまだ選んでいないとき: どの家に入るか選ぶ
export function HouseChooser({ groups, onSelect }) {
  return (
    <Frame>
      <section className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-bold">どの家に入りますか?</h1>
        <p className="text-sm text-muted-foreground">このアカウントで入っている家です。あとから設定で切り替えられます</p>
      </section>
      <HouseList houses={groups} onSelect={onSelect} />
    </Frame>
  )
}

// 家の一覧を読み込めなかった(サーバーの一時的な停止・通信の切れ目)。ログインはそのまま
export function ConnectionProblem({ onRetry }) {
  const { houses } = getLoginMemory()
  return (
    <Frame>
      <section role="alert" className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <WifiOff className="size-6" />
        </span>
        <h1 className="text-lg font-bold">サーバーにつながりません</h1>
        <p className="text-sm text-muted-foreground">
          ログインはそのままです。つながり次第、自動で家に戻ります(数秒ごとに試しています)
        </p>
      </section>
      {houses.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">このアカウントの家</p>
          <HouseList houses={houses} disabled />
        </div>
      )}
      <Button className="h-11" onClick={() => onRetry()}>
        <RefreshCw className="size-4" />
        今すぐ試す
      </Button>
    </Frame>
  )
}
