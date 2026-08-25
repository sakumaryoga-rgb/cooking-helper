import { useMemo, useState } from 'react'
import { Plus, Minus, Search } from 'lucide-react'
import { useIngredients } from '@/hooks/useIngredients'
import { useIngredientBatches } from '@/hooks/useIngredientBatches'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { IngredientPicker } from '@/components/IngredientPicker'
import { SwipeToDelete } from '@/components/SwipeToDelete'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { supabase } from '@/supabaseClient'
import { formatQuantity } from '@/lib/format'
import { getExpiryInfo, formatExpiryLabel } from '@/lib/shelfLife'

// g/ml のような細かい単位はまとめて増減、個数系は1ずつ増減する
const STEP_BY_UNIT = { g: 10, ml: 10 }
function stepFor(unit) {
  return STEP_BY_UNIT[unit] ?? 1
}

function expiryColorClass(daysLeft) {
  if (daysLeft <= 1) return 'text-destructive'
  if (daysLeft <= 3) return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

export function Fridge({ groupId }) {
  const { ingredients, loading, removeIngredient } = useIngredients(groupId)
  const { batches } = useIngredientBatches(groupId)
  const { catalog } = useIngredientCatalog()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dateAsPurchaseDate, setDateAsPurchaseDate] = useState(true)

  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])

  const batchesByIngredient = useMemo(() => {
    const map = new Map()
    for (const batch of batches) {
      if (!map.has(batch.ingredient_id)) map.set(batch.ingredient_id, [])
      map.get(batch.ingredient_id).push(batch)
    }
    return map
  }, [batches])

  const rows = useMemo(() => {
    const list = ingredients
      .filter((i) => i.name.includes(query.trim()))
      .map((ingredient) => ({
        ingredient,
        expiry: getExpiryInfo(ingredient, batchesByIngredient.get(ingredient.id), catalogById),
      }))

    list.sort((a, b) => {
      if (a.expiry && b.expiry) return a.expiry.daysLeft - b.expiry.daysLeft
      if (a.expiry) return -1
      if (b.expiry) return 1
      return a.ingredient.name.localeCompare(b.ingredient.name, 'ja')
    })

    return list
  }, [ingredients, query, batchesByIngredient, catalogById])

  async function adjustQuantity(ingredient, delta) {
    // 在庫の増減・ロットの記録・在庫0時の自動削除を1トランザクションで行う
    // (以前はクライアント側で複数回に分けて処理しており、連打や複数端末からの
    // 同時操作で更新が失われることがあった)
    const { data, error } = await supabase.rpc('adjust_ingredient_quantity', {
      p_ingredient_id: ingredient.id,
      p_delta: delta,
      p_dated_today: dateAsPurchaseDate,
    })
    if (error) {
      console.error('数量の更新に失敗しました', error)
      return
    }
    if (data?.[0]?.deleted) {
      removeIngredient(ingredient.id)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-medium">冷蔵庫</h1>
        <Button size="sm" onClick={() => setPickerOpen(true)}>
          <Plus className="size-4" />
          追加
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="食材を検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <div className="flex flex-col">
          <Label htmlFor="date-as-purchase" className="text-sm">
            追加日を購入日にする
          </Label>
          <p className="text-xs text-muted-foreground">
            オンだと「+」で増やした分を今日の日付で記録し、賞味期限の目安を計算します
          </p>
        </div>
        <Switch id="date-as-purchase" checked={dateAsPurchaseDate} onCheckedChange={setDateAsPurchaseDate} />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          まだ食材がありません。「追加」から登録しましょう。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border">
          {rows.map(({ ingredient, expiry }) => (
            <li key={ingredient.id}>
              <SwipeToDelete onDelete={() => removeIngredient(ingredient.id)}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ingredient.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span>
                        {formatQuantity(ingredient.quantity)} {ingredient.unit}
                      </span>
                      {expiry && (
                        <span className={expiryColorClass(expiry.daysLeft)}>
                          ・{formatExpiryLabel(expiry.daysLeft)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-7"
                      onClick={() => adjustQuantity(ingredient, -stepFor(ingredient.unit))}
                      aria-label="減らす"
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-7"
                      onClick={() => adjustQuantity(ingredient, stepFor(ingredient.unit))}
                      aria-label="増やす"
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </SwipeToDelete>
            </li>
          ))}
        </ul>
      )}

      <IngredientPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        groupId={groupId}
        ingredients={ingredients}
        onSelect={() => setPickerOpen(false)}
      />
    </div>
  )
}
