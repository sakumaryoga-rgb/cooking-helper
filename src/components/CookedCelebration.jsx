import { useState } from 'react'
import { Carrot, ChefHat, Egg, Fish, Infinity as InfinityIcon, ShoppingCart, Sparkles, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addToShoppingList } from '@/lib/shopping'

// 「これを作る」を確定したあとの、画面いっぱいの「お疲れ様でした」。
// このレシピで使った常備品のうち、なくなったものをマークすると買い物リストに入る(常備品以外は入れない)
export function CookedCelebration({ title, staples, onUndo, onClose, undoing }) {
  const [picked, setPicked] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggle(id) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function finish() {
    if (picked.size > 0) {
      setSaving(true)
      const result = await addToShoppingList([...picked])
      setSaving(false)
      if (result.error) {
        setError(result.error)
        return
      }
    }
    onClose(picked.size)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="お料理お疲れ様でした"
      className="fixed inset-0 z-50 overflow-y-auto bg-[radial-gradient(circle_at_50%_30%,#fff3b0_0%,#fbf8f1_65%)] px-4 pt-safe pb-safe dark:bg-[radial-gradient(circle_at_50%_30%,#4a3a10_0%,#141414_65%)]"
    >
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-6 py-10 text-center">
        <div className="relative" aria-hidden="true">
          <Carrot className="absolute -left-12 top-2 size-8 animate-[float_3.2s_ease-in-out_infinite] text-orange-500" strokeWidth={2.2} />
          <Egg className="absolute -right-10 -top-2 size-7 animate-[float_3.6s_ease-in-out_0.5s_infinite] text-amber-600" strokeWidth={2.2} />
          <Fish className="absolute -right-14 bottom-0 size-8 animate-[float_4s_ease-in-out_1s_infinite] text-sky-500" strokeWidth={2.2} />
          <Sparkles className="absolute -left-6 -top-6 size-6 animate-pulse text-amber-500" />
          <span className="flex size-28 animate-[pop-in_0.5s_ease-out_both] items-center justify-center rounded-full border-4 border-[#3b2a1c] bg-primary shadow-[0_6px_0_#3b2a1c]">
            <ChefHat className="size-14 text-[#3b2a1c]" strokeWidth={2} />
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-3xl font-bold tracking-tight">お料理お疲れ様でした!</p>
          <p className="text-sm text-muted-foreground">「{title}」で使った分を、冷蔵庫から引きました</p>
        </div>

        {staples.length > 0 && (
          <div className="flex w-full flex-col gap-3 rounded-3xl border-2 border-[#3b2a1c] bg-card p-4 text-left shadow-[0_4px_0_#3b2a1c]">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <InfinityIcon className="size-4 text-violet-600" />
              なくなった常備品はありますか?
            </p>
            <p className="-mt-1.5 text-xs text-muted-foreground">押すと買い物リストに入ります</p>
            <div className="flex flex-wrap gap-2">
              {staples.map((s) => {
                const on = picked.has(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.id)}
                    className={`inline-flex items-center gap-1 rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
                      on ? 'border-[#3b2a1c] bg-primary text-primary-foreground' : 'border-border bg-background'
                    }`}
                  >
                    {on && <ShoppingCart className="size-3.5" />}
                    {s.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex w-full flex-col gap-2">
          <Button size="lg" className="w-full" onClick={finish} disabled={saving}>
            {picked.size > 0 ? (
              <>
                <ShoppingCart />
                {saving ? '入れています...' : `${picked.size}品を買い物リストに入れて閉じる`}
              </>
            ) : (
              '閉じる'
            )}
          </Button>
          <button type="button" onClick={onUndo} disabled={undoing} className="inline-flex items-center justify-center gap-1 self-center text-xs text-muted-foreground underline-offset-2 hover:underline">
            <Undo2 className="size-3.5" />
            {undoing ? '取り消しています...' : '作ったのを取り消す(在庫を戻す)'}
          </button>
        </div>
      </div>
    </div>
  )
}
