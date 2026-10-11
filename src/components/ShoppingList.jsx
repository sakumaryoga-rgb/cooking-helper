import { useState } from 'react'
import { Check, Infinity as InfinityIcon, ShoppingCart } from 'lucide-react'
import { markBought, shoppingItems } from '@/lib/shopping'

// ホームの買い物リスト(メモ帳ふう)。買ったら丸を押して外す
export function ShoppingList({ ingredients, onChanged }) {
  const items = shoppingItems(ingredients)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  async function bought(item) {
    setBusyId(item.id)
    setError('')
    const result = await markBought(item.id)
    setBusyId(null)
    if (result.error) setError(result.error)
    onChanged?.()
  }

  return (
    <section aria-label="買い物リスト" className="relative overflow-hidden rounded-3xl border-2 border-[#3b2a1c] bg-[#fffdf5] shadow-[0_4px_0_#3b2a1c] dark:bg-card">
      <div className="flex items-center justify-between gap-2 border-b-2 border-dashed border-[#3b2a1c]/20 bg-primary/30 px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-base font-bold">
          <ShoppingCart className="size-4.5" />
          買い物リスト
        </h2>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          買い足すものはありません。料理のあとや冷蔵庫の常備品の棚から「なくなった」を入れられます
        </p>
      ) : (
        <ul className="flex flex-col bg-[repeating-linear-gradient(transparent,transparent_43px,rgb(59_42_28/0.08)_43px,rgb(59_42_28/0.08)_44px)] px-2 py-1">
          {items.map((item) => (
            <li key={item.id} className="flex h-11 items-center gap-3 px-2">
              <button
                type="button"
                onClick={() => bought(item)}
                disabled={busyId === item.id}
                aria-label={`${item.name}を買った`}
                className="group flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-[#3b2a1c]/50 hover:border-[#3b2a1c] hover:bg-primary"
              >
                <Check className="size-3.5 opacity-0 group-hover:opacity-100" strokeWidth={3} />
              </button>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
              {item.is_staple && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                  <InfinityIcon className="size-2.5" />
                  常備品
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-4 pb-3 text-sm text-destructive">{error}</p>}
    </section>
  )
}
