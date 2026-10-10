import { useState } from 'react'
import { ArrowLeftRight, Plus, X } from 'lucide-react'
import { IngredientPicker } from '@/components/IngredientPicker'
import { applyChoice } from '@/lib/recipeImport/match'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { QuantityInput } from '@/components/QuantityInput'

let nextKey = 0
export const keyOf = () => `item-${nextKey++}`

// レシピの材料の一覧(追加・編集で共通)。items は resolveIngredient の結果か、冷蔵庫から選んだ食材
export function RecipeItemsEditor({ groupId, ingredients, items, setItems, emptyText }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replaceKey, setReplaceKey] = useState(null) // 付け替える材料の行(null は追加)

  function handlePicked(ingredient) {
    if (replaceKey) {
      // 取り込んだ材料を正しい食材に付け替える。取り込んだときの表記は、保存時にこの家の別名として覚える
      choose(replaceKey, { kind: 'existing', ingredient })
      setReplaceKey(null)
      return
    }
    setItems((prev) => [
      ...prev,
      { key: keyOf(), kind: 'existing', ingredient, name: ingredient.name, unit: ingredient.unit, requiredQuantity: 1, include: true, needsCheck: false },
    ])
  }

  // どの食材かを選ぶ(候補・新しい食材・ほかの食材)
  function choose(key, option) {
    setItems((prev) => prev.map((i) => (i.key === key ? applyChoice(i, option) : i)))
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
                  {item.kind === 'new' && !item.needsChoice && <span className="ml-1 text-xs text-muted-foreground">(新しい食材)</span>}
                </span>
                <QuantityInput
                  className="w-20 h-8"
                  // 数で分からない分量は空のまま保存できる(元の表記を表示)。1/2 や ½ も入れられる
                  placeholder={item.amountText || ''}
                  value={item.requiredQuantity}
                  onChange={(v) => updateItem(item.key, { requiredQuantity: v, needsCheck: false })}
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
              {(item.rawText || item.needsCheck || item.note) && (
                <p className="pl-6 text-xs text-muted-foreground">
                  {item.rawText}
                  {item.note && <span className="ml-1">・状態: {item.note}</span>}
                  {item.needsCheck && item.include && !(Number(item.requiredQuantity) > 0) && (
                    <span className="ml-1 text-violet-700 dark:text-violet-400">
                      ・分量は「{item.amountText || '不明'}」のまま保存します(作るときに在庫から引く量を入れられます)
                    </span>
                  )}
                </p>
              )}
              {item.needsChoice && item.include && (
                <div className="ml-6 flex flex-col gap-1.5 rounded-xl border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/40">
                  <p className="text-xs font-medium">「{item.sourceName}」はどの食材ですか?(選ばなくても、確認待ちのまま保存できます)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.candidates.map((option) => (
                      <Button
                        key={option.kind + (option.ingredient?.id ?? option.catalogItem?.id)}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full bg-background text-xs"
                        onClick={() => choose(item.key, option)}
                      >
                        {option.name}
                        <span className="text-[10px] text-muted-foreground">{option.kind === 'existing' ? '冷蔵庫' : 'リスト'}</span>
                      </Button>
                    ))}
                    <Button type="button" size="sm" variant="ghost" className="h-7 rounded-full text-xs" onClick={() => choose(item.key, { kind: 'new' })}>
                      新しい食材「{item.sourceName}」
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 rounded-full text-xs" onClick={() => openPicker(item.key)}>
                      ほかから選ぶ
                    </Button>
                  </div>
                </div>
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
        <p role="status" className="rounded-xl bg-muted/60 px-3 py-2 text-xs">
          自動で決まった材料 {items.filter((i) => i.include && !i.needsChoice).length} 件
          {items.some((i) => i.include && i.needsChoice) && (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              ・確認待ち {items.filter((i) => i.include && i.needsChoice).length} 件(このまま保存して、あとでレシピの画面で選べます)
            </span>
          )}
        </p>
      )}
      {items.some((i) => i.rawText) && (
        <p className="text-xs text-muted-foreground">
          違う食材になっている材料は「⇄」で正しい食材に変えられます。選んだ・変えた表記は、この家で覚えて次から自動で選びます
        </p>
      )}

      <IngredientPicker
        title="材料を選ぶ"
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
