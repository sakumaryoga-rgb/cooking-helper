import { useState } from 'react'
import { Plus, Minus, Search } from 'lucide-react'
import { useIngredients } from '@/hooks/useIngredients'
import { IngredientPicker } from '@/components/IngredientPicker'
import { SwipeToDelete } from '@/components/SwipeToDelete'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/supabaseClient'
import { formatQuantity } from '@/lib/format'

// g/ml のような細かい単位はまとめて増減、個数系は1ずつ増減する
const STEP_BY_UNIT = { g: 10, ml: 10 }
function stepFor(unit) {
  return STEP_BY_UNIT[unit] ?? 1
}

const REMOVE_ANIMATION_MS = 200

export function Fridge({ groupId }) {
  const { ingredients, loading, removeIngredient } = useIngredients(groupId)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [removingIds, setRemovingIds] = useState(() => new Set())

  const filtered = ingredients.filter((i) => i.name.includes(query.trim()))

  async function adjustQuantity(ingredient, delta) {
    const next = Math.max(0, Number(ingredient.quantity) + delta)
    const { error } = await supabase.from('ingredients').update({ quantity: next }).eq('id', ingredient.id)
    if (error) console.error('数量の更新に失敗しました', error)
  }

  function handleDelete(ingredient) {
    // まず縮小アニメーションを見せてから、実データを削除する(Apple風の滑らかな削除体験)
    setRemovingIds((prev) => new Set(prev).add(ingredient.id))
    window.setTimeout(() => removeIngredient(ingredient.id), REMOVE_ANIMATION_MS)
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

      {loading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          まだ食材がありません。「追加」から登録しましょう。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border">
          {filtered.map((ingredient) => {
            const removing = removingIds.has(ingredient.id)
            return (
              <li
                key={ingredient.id}
                className="overflow-hidden transition-[max-height,opacity] duration-200 ease-out"
                style={{ maxHeight: removing ? 0 : 80, opacity: removing ? 0 : 1 }}
              >
                <SwipeToDelete onDelete={() => handleDelete(ingredient)}>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ingredient.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatQuantity(ingredient.quantity)} {ingredient.unit}
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
            )
          })}
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
