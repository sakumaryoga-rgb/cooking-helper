import { useState } from 'react'
import { ArrowLeftRight, Plus, X } from 'lucide-react'
import { IngredientPicker } from '@/components/IngredientPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

let nextKey = 0
export const keyOf = () => `item-${nextKey++}`

// レシピの材料の一覧(追加・編集で共通)。items は resolveIngredient の結果か、冷蔵庫から選んだ食材
export function RecipeItemsEditor({ groupId, ingredients, items, setItems, emptyText }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replaceKey, setReplaceKey] = useState(null) // 付け替える材料の行(null は追加)

  function handlePicked(ingredient) {
    if (replaceKey) {
      // 取り込んだ材料を正しい食材に付け替える。取り込んだときの表記は、保存時にこの家の別名として覚える
      setItems((prev) =>
        prev.map((i) =>
          i.key === replaceKey
            ? {
                ...i,
                kind: 'existing',
                ingredient,
                name: ingredient.name,
                unit: ingredient.unit,
                needsCheck: i.unit !== ingredient.unit,
                include: true,
                learnAlias: i.sourceName && ingredient.catalog_id ? { alias: i.sourceName, catalogId: ingredient.catalog_id } : undefined,
              }
            : i
        )
      )
      setReplaceKey(null)
      return
    }
    setItems((prev) => [
      ...prev,
      { key: keyOf(), kind: 'existing', ingredient, name: ingredient.name, unit: ingredient.unit, requiredQuantity: 1, include: true, needsCheck: false },
    ])
  }

  function updateItem(key, patch) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  }

  function removeItem(key) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  const usedIngredientIds = items.filter((i) => i.kind === 'existing' && i.key !== replaceKey).map((i) => i.ingredient.id)

  function openPicker(key = null) {
    setReplaceKey(key)
    setPickerOpen(true)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>材料</Label>
        <Button type="button" size="sm" variant="outline" onClick={() => openPicker()}>
          <Plus className="size-4" />
          材料を選択
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border bg-card">
          {items.map((item) => (
            <li key={item.key} className={`flex flex-col gap-1 px-3 py-2 ${item.include ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={item.include}
                  onChange={(e) => updateItem(item.key, { include: e.target.checked })}
                  aria-label={`${item.name}を保存する`}
                />
                <span className="flex-1 text-sm truncate">
                  {item.name}
                  {item.kind === 'new' && <span className="ml-1 text-xs text-muted-foreground">(新しい食材)</span>}
                </span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  className="w-20 h-8"
                  value={item.requiredQuantity}
                  onChange={(e) => updateItem(item.key, { requiredQuantity: e.target.value, needsCheck: false })}
                  aria-label={`${item.name}の分量`}
                />
                <span className="text-xs text-muted-foreground w-10">{item.unit}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => openPicker(item.key)}
                  aria-label={`${item.name}を別の食材に変える`}
                  title="別の食材に変える"
                >
                  <ArrowLeftRight className="size-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => removeItem(item.key)} aria-label={`${item.name}を削除`}>
                  <X className="size-3.5" />
                </Button>
              </div>
              {(item.rawText || item.needsCheck) && (
                <p className="pl-6 text-xs text-muted-foreground">
                  {item.rawText}
                  {item.needsCheck && item.include && <span className="ml-1 text-destructive">分量を確かめてください</span>}
                </p>
              )}
              {item.learnAlias && (
                <p className="pl-6 text-xs text-emerald-700 dark:text-emerald-400">
                  「{item.learnAlias.alias}」を「{item.name}」として覚えます(次から自動で選ばれます)
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.some((i) => i.rawText) && (
        <p className="text-xs text-muted-foreground">
          違う食材になっている材料は「⇄」で正しい食材に変えられます。変えた表記は、この家で覚えます
        </p>
      )}

      <IngredientPicker
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open)
          if (!open) setReplaceKey(null)
        }}
        groupId={groupId}
        ingredients={ingredients}
        onSelect={handlePicked}
        excludeIds={usedIngredientIds}
      />
    </div>
  )
}
