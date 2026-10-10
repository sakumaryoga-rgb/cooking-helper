import { useState } from 'react'
import { Hash, Infinity as InfinityIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuantityInput } from '@/components/QuantityInput'
import { parseQuantity } from '@/lib/quantity'
import { supabase } from '@/supabaseClient'

// g・ml のような量は人によって違うので空欄から、個・本などは 1 から始める
const BLANK_UNITS = new Set(['g', 'ml'])

function initialRows(ingredients, isStapleCategory) {
  return ingredients.map((i) => ({
    ingredient: i,
    staple: Boolean(i.is_staple) || (!(Number(i.quantity) > 0) && isStapleCategory(i)),
    quantity: BLANK_UNITS.has(i.unit) ? '' : '1',
  }))
}

// 複数の食材をまとめて冷蔵庫に入れる。1行ずつ「数」か「常備品」を選び、1回の「入れる」で終わる。
// 量が空の行は在庫を増やさない(一覧に出るので、あとから＋で増やせる)。期限は入れない(必要なら行の📅から)
export function BatchStockDialog({ ingredients, datedToday, isStapleCategory, onClose, onSaved }) {
  const [rows, setRows] = useState(() => initialRows(ingredients, isStapleCategory))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update(id, patch) {
    setRows((prev) => prev.map((r) => (r.ingredient.id === id ? { ...r, ...patch } : r)))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const toStaple = rows.filter((r) => r.staple && !r.ingredient.is_staple).map((r) => r.ingredient.id)
    const toUnstaple = rows.filter((r) => !r.staple && r.ingredient.is_staple).map((r) => r.ingredient.id)
    const failed = []
    if (toStaple.length > 0) {
      const { error: e } = await supabase.from('ingredients').update({ is_staple: true }).in('id', toStaple)
      if (e) failed.push('常備品')
    }
    if (toUnstaple.length > 0) {
      const { error: e } = await supabase.from('ingredients').update({ is_staple: false }).in('id', toUnstaple)
      if (e) failed.push('常備品の解除')
    }
    for (const r of rows) {
      const delta = r.staple ? null : parseQuantity(r.quantity)
      if (!delta) continue
      const { error: e } = await supabase.rpc('adjust_stock', {
        p_ingredient_id: r.ingredient.id,
        p_delta: delta,
        p_dated_today: datedToday,
        p_best_before: null,
        p_use_by: null,
      })
      if (e) failed.push(r.ingredient.name)
    }
    setSaving(false)
    onSaved?.()
    if (failed.length > 0) {
      setError(`${failed.join('、')}を保存できませんでした。もう一度お試しください`)
      return
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85svh] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{rows.length}品を冷蔵庫に入れる</DialogTitle>
          <DialogDescription>数は 1/2 や 0.5 でも入れられます。空欄の食材は一覧に出るだけです</DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 flex flex-col divide-y overflow-y-auto overscroll-contain px-1">
          {rows.map((r) => (
            <li key={r.ingredient.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.ingredient.name}</span>
              <div role="radiogroup" aria-label={`${r.ingredient.name}の記録のしかた`} className="flex shrink-0 rounded-full bg-muted p-0.5">
                {[
                  { id: false, Icon: Hash, label: '数' },
                  { id: true, Icon: InfinityIcon, label: '常備' },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={r.staple === o.id}
                    aria-label={`${r.ingredient.name}を${o.id ? '常備品にする' : '数で記録する'}`}
                    onClick={() => update(r.ingredient.id, { staple: o.id })}
                    className={`flex items-center gap-0.5 rounded-full px-2 py-1 text-xs font-medium ${
                      r.staple === o.id ? (o.id ? 'bg-violet-600 text-white' : 'bg-primary text-primary-foreground') : 'text-muted-foreground'
                    }`}
                  >
                    <o.Icon className="size-3" />
                    {o.label}
                  </button>
                ))}
              </div>
              {r.staple ? (
                <span className="w-[6.5rem] shrink-0 text-center text-xs text-violet-700 dark:text-violet-300">数えない</span>
              ) : (
                <QuantityInput
                  className="h-8 w-16"
                  value={r.quantity}
                  placeholder="量"
                  onChange={(v) => update(r.ingredient.id, { quantity: v })}
                  aria-label={`${r.ingredient.name}の量`}
                  suffix={<span className="w-8 text-xs text-muted-foreground">{r.ingredient.unit}</span>}
                />
              )}
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '冷蔵庫に入れる'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
