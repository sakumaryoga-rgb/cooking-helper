import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QuantityInput } from '@/components/QuantityInput'
import { formatQuantity } from '@/lib/format'

// 「今回だけ食材を追加」: 冷蔵庫に余っている食材を、この料理で使った分だけ在庫から引く(レシピの材料は変えない)。
// 選べるのは在庫のある食材(常備品と、すでに確認の画面にある食材は除く)
export function ExtraIngredientAdder({ ingredients, excludeIds, onAdd }) {
  const [open, setOpen] = useState(false)
  const [pickedId, setPickedId] = useState('')
  const [quantity, setQuantity] = useState('')
  const options = useMemo(
    () =>
      (ingredients ?? [])
        .filter((i) => !i.is_staple && Number(i.quantity) > 0 && !excludeIds.has(i.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    [ingredients, excludeIds]
  )
  const picked = options.find((i) => i.id === pickedId)

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="self-start rounded-full text-xs" onClick={() => setOpen(true)} disabled={options.length === 0}>
        <Plus className="size-3.5" />
        今回だけ食材を追加
      </Button>
    )
  }

  function add() {
    if (!picked || !(Number(quantity) > 0)) return
    onAdd(picked, quantity)
    setPickedId('')
    setQuantity('')
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 px-3 py-2.5" role="group" aria-label="今回だけ食材を追加">
      <p className="text-xs text-muted-foreground">冷蔵庫の食材を、今回の料理で使った分だけ在庫から引きます。レシピの材料は変わりません</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
          value={pickedId}
          onChange={(e) => {
            setPickedId(e.target.value)
            setQuantity('')
          }}
          aria-label="追加する食材"
        >
          <option value="">食材を選ぶ</option>
          {options.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}(在庫 {formatQuantity(i.quantity)}
              {i.unit})
            </option>
          ))}
        </select>
        <QuantityInput className="h-8 w-20" value={quantity} onChange={setQuantity} aria-label="追加する食材の使用量" disabled={!picked} />
        <span className="min-w-8 whitespace-nowrap text-xs text-muted-foreground">{picked?.unit ?? ''}</span>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button type="button" size="sm" variant="ghost" className="h-7 rounded-full text-xs" onClick={() => setOpen(false)}>
          やめる
        </Button>
        <Button type="button" size="sm" className="h-7 rounded-full text-xs" onClick={add} disabled={!picked || !(Number(quantity) > 0)}>
          追加する
        </Button>
      </div>
    </div>
  )
}
