import { Button } from '@/components/ui/button'
import { QuantityInput } from '@/components/QuantityInput'

const CHOICES = [
  { value: 'have', label: '家にある' },
  { value: 'staple', label: '常備品' },
  { value: 'none', label: 'ない' },
]

// レシピを保存する前に、冷蔵庫にまだない材料(在庫0・この家に初めて出てきた食材)を
// 「家にある(量)」「常備品」「ない」から選んでもらう。選んだものだけ冷蔵庫・常備品に入れる
// rows: [{ key, name, unit, choice, quantity }](lib/stockOnSave の stockCandidates)
export function StockOnSave({ rows, onChange, onConfirm, onBack, saving }) {
  return (
    <section role="dialog" aria-label="家にある材料" className="flex flex-col gap-3 rounded-3xl border-2 border-[#3b2a1c] bg-card p-4 shadow-[0_4px_0_#3b2a1c]">
      <div>
        <h2 className="text-base font-bold">家にある材料はありますか?</h2>
        <p className="text-xs text-muted-foreground">
          冷蔵庫にまだない材料です。「家にある」は量を入れて冷蔵庫に、「常備品」は数えずに常備品の棚に入れます。「ない」はレシピの材料としてだけ覚えます
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-2xl border">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-2 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{row.name}</span>
              <div className="flex shrink-0 rounded-full bg-muted p-0.5" role="radiogroup" aria-label={`${row.name}は家にあるか`}>
                {CHOICES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={row.choice === c.value}
                    onClick={() => onChange(row.key, { choice: c.value })}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                      row.choice === c.value
                        ? c.value === 'have'
                          ? 'bg-emerald-600 text-white'
                          : c.value === 'staple'
                            ? 'bg-violet-600 text-white'
                            : 'bg-foreground text-background'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {row.choice === 'have' && (
              <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                <span>今ある量</span>
                <QuantityInput
                  className="h-8 w-20"
                  value={row.quantity}
                  onChange={(v) => onChange(row.key, { quantity: v })}
                  aria-label={`${row.name}の今ある量`}
                />
                <span>{row.unit}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button type="button" className="flex-1" onClick={onConfirm} disabled={saving || rows.some((r) => r.choice === 'have' && !(Number(r.quantity) > 0))}>
          {saving ? '保存中...' : 'この内容で保存'}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
          戻る
        </Button>
      </div>
    </section>
  )
}
