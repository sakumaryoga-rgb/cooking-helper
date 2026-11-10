import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { IngredientPicker } from '@/components/IngredientPicker'
import { pickedItem } from '@/components/RecipeItemsEditor'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { emptyStep, usageMismatches } from '@/lib/recipeSteps'
import { QuantityInput } from '@/components/QuantityInput'

// 作り方(オリジナルレシピ)。手順ごとに、そのレシピの材料から使うものと量を選べる(どちらも任意)。
// 手順の量は目安で、在庫はレシピの材料の分量で引く(手順の量では引かない)
// onUsesChanged(nextSteps, itemKeys): 手順で使う材料・量が変わったとき(上の材料の分量を手順の合計にそろえるため)
// setItems を渡すと、手順から新しい材料を足せる(上の材料にも入り、保存時の「家にある材料」の候補にもなる)
const NEW_ITEM = '__new__'
export function RecipeStepsEditor({ steps, setSteps, items, onUsesChanged, setItems, groupId, ingredients }) {
  const available = items.filter((i) => i.include)
  const [pickerStepId, setPickerStepId] = useState(null) // 新しい材料を足す手順
  const update = (id, patch) => setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const move = (index, d) =>
    setSteps((prev) => {
      const next = [...prev]
      ;[next[index], next[index + d]] = [next[index + d], next[index]]
      return next
    })
  const remove = (id) => setSteps((prev) => (prev.length === 1 ? [emptyStep()] : prev.filter((s) => s.id !== id)))
  const addUse = (step, itemKey) => {
    if (itemKey === NEW_ITEM) {
      setPickerStepId(step.id)
      return
    }
    if (!itemKey || step.uses.some((u) => u.itemKey === itemKey)) return
    setUses(step, [...step.uses, { itemKey, quantity: '' }], itemKey)
  }
  // 使う材料を変えた手順を反映し、変わった材料を知らせる(今の手順から次の手順を作る: 更新関数の中で他の状態を変えない)
  function setUses(step, uses, itemKey) {
    const next = steps.map((s) => (s.id === step.id ? { ...s, uses } : s))
    setSteps(next)
    onUsesChanged?.(next, [itemKey])
  }
  const setUse = (step, itemKey, quantity) => setUses(step, step.uses.map((u) => (u.itemKey === itemKey ? { ...u, quantity } : u)), itemKey)
  const removeUse = (step, itemKey) => setUses(step, step.uses.filter((u) => u.itemKey !== itemKey), itemKey)
  const mismatches = usageMismatches(steps, items)
  // 上の材料にない食材を選んだら、上の材料に足してから、この手順で使う材料にする
  function handlePicked(ingredient) {
    const step = steps.find((s) => s.id === pickerStepId)
    setPickerStepId(null)
    if (!step) return
    const existing = items.find((i) => i.kind === 'existing' && i.ingredient?.id === ingredient.id)
    if (existing) {
      if (!existing.include) setItems((prev) => prev.map((i) => (i.key === existing.key ? { ...i, include: true } : i)))
      addUse(step, existing.key)
      return
    }
    const added = pickedItem(ingredient)
    setItems((prev) => [...prev, added])
    addUse(step, added.key)
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">作り方</legend>
      <p className="-mt-1 text-xs text-muted-foreground">手順ごとに使う材料と量を選べます(任意)。在庫はレシピの材料の分量で引くので、二重に減ることはありません</p>
      <ol className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={step.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground" aria-hidden="true">
                {i + 1}
              </span>
              <Textarea
                aria-label={`手順${i + 1}`}
                rows={2}
                maxLength={500}
                className="min-h-10 flex-1"
                value={step.text}
                onChange={(e) => update(step.id, { text: e.target.value })}
                placeholder={i === 0 ? '例: 玉ねぎを薄切りにする' : '次の手順'}
              />
              <div className="flex flex-col">
                <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`手順${i + 1}を上へ`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`手順${i + 1}を下へ`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`手順${i + 1}を消す`} onClick={() => remove(step.id)}>
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* この手順で使う材料 */}
            <div className="flex flex-col gap-1.5 pl-8">
              {step.uses.map((u) => {
                const item = available.find((x) => x.key === u.itemKey)
                if (!item) return null
                return (
                  <div key={u.itemKey} className="flex items-center gap-2 rounded-xl bg-muted/60 px-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                    <QuantityInput
                      className="h-7 w-20 bg-background"
                      value={u.quantity}
                      placeholder="量"
                      onChange={(v) => setUse(step, u.itemKey, v)}
                      aria-label={`手順${i + 1}の${item.name}の量`}
                    />
                    <span className="w-8 text-xs text-muted-foreground">{item.unit}</span>
                    <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`手順${i + 1}から${item.name}を外す`} onClick={() => removeUse(step, u.itemKey)}>
                      <X className="size-3" />
                    </Button>
                  </div>
                )
              })}
              {available.length > 0 || setItems ? (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Plus className="size-3.5" />
                  <select
                    className="h-7 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs"
                    value=""
                    onChange={(e) => addUse(step, e.target.value)}
                    aria-label={`手順${i + 1}で使う材料を追加`}
                  >
                    <option value="">この手順で使う材料を追加</option>
                    {available
                      .filter((x) => !step.uses.some((u) => u.itemKey === x.key))
                      .map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.name}
                        </option>
                      ))}
                    {setItems && <option value={NEW_ITEM}>＋ 上の材料にない食材を選ぶ</option>}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">上で材料を追加すると、手順ごとに選べます</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" size="sm" className="self-start rounded-full" onClick={() => setSteps((prev) => [...prev, emptyStep()])} disabled={steps.length >= 30}>
        <Plus className="size-4" />
        手順を追加
      </Button>
      {mismatches.length > 0 && (
        <div role="note" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          手順の量の合計が、材料の分量と違います(このまま保存できます。在庫は材料の分量で引きます)
          <ul className="mt-1 list-disc pl-4">
            {mismatches.map((m) => (
              <li key={m.key}>
                {m.name}: 手順の合計 {m.stepsTotal}
                {m.unit} / 材料 {m.recipeQuantity}
                {m.unit}
              </li>
            ))}
          </ul>
        </div>
      )}
      {setItems && (
        <IngredientPicker
          title="手順で使う材料を選ぶ"
          open={pickerStepId != null}
          onOpenChange={(open) => !open && setPickerStepId(null)}
          groupId={groupId}
          ingredients={ingredients}
          onSelect={handlePicked}
        />
      )}
    </fieldset>
  )
}
