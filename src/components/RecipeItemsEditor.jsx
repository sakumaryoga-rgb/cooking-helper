import { useMemo, useState } from 'react'
import { ArrowLeftRight, Infinity as InfinityIcon, Plus, X } from 'lucide-react'
import { IngredientPicker } from '@/components/IngredientPicker'
import { applyChoice, normalizeName } from '@/lib/recipeImport/match'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { QuantityInput } from '@/components/QuantityInput'
import { useCommonConversions } from '@/hooks/useCommonConversions'
import { parseAmount } from '@/lib/recipeImport/ingredientLine'
import { describeEstimate, resolveConversion } from '@/lib/unitConversion'
import { guessCategory } from '@/lib/ingredientCategory'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { supabase } from '@/supabaseClient'

const VAGUE_AMOUNT = '適量'
const isVagueAmount = (item) => item.amountText === VAGUE_AMOUNT && !(Number(item.requiredQuantity) > 0)

let nextKey = 0
export const keyOf = () => `item-${nextKey++}`

// レシピの材料の一覧(追加・編集で共通)。items は resolveIngredient の結果か、冷蔵庫から選んだ食材
// 分量を数にできなかった材料に、全体共通の目安を出す(押したときだけ入れる。勝手には入れない)
function estimateFor(item, common) {
  if (!item.needsCheck || Number(item.requiredQuantity) > 0 || !item.amountText) return null
  const target =
    item.kind === 'existing' ? item.ingredient : item.kind === 'catalog' && item.catalogItem ? { unit: item.unit, catalog_id: item.catalogItem.id } : null
  if (!target) return null
  const a = parseAmount(item.amountText)
  if (a.quantity == null || !a.unit || a.range) return null
  // 条件(サイズ・殻・生米/ご飯など)は、食材名・取り込んだ表記・注記から読む
  const state = [item.name, item.sourceName, item.note, item.rawText].filter(Boolean).join(' ')
  const r = resolveConversion({ quantity: a.quantity, unit: a.unit, ingredient: target, common, state })
  return r && r.kind === 'common' ? { quantity: r.quantity, text: describeEstimate(r, target.unit) } : null
}

export function RecipeItemsEditor({ groupId, ingredients, items, setItems, emptyText }) {
  const common = useCommonConversions()
  const { catalog } = useIngredientCatalog()
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])
  const fridgeById = useMemo(() => new Map((ingredients ?? []).map((i) => [i.id, i])), [ingredients])
  // 「適量」を選ぶのに常備品の登録が必要な材料(その場で登録するか確かめる)
  const [stapleAskKey, setStapleAskKey] = useState(null)
  const [stapleBusy, setStapleBusy] = useState(false)
  const [stapleError, setStapleError] = useState('')
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
    // 別の食材に変えたら、前の食材を常備品にする予定は取り消す
    setItems((prev) => prev.map((i) => (i.key === key ? { ...applyChoice(i, option), stapleOnSave: false } : i)))
  }

  function updateItem(key, patch) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  }

  // 調味料だけ「適量」を選べる。この家にまだない調味料(取り込みで初めて出てきたもの)も選べる
  function isSeasoning(item) {
    if (item.needsChoice) return false
    if (item.kind === 'existing' && item.ingredient) {
      return (catalogById.get(item.ingredient.catalog_id)?.category ?? guessCategory(item.ingredient.name)) === '調味料・油'
    }
    if (item.kind === 'catalog' && item.catalogItem) return (item.catalogItem.category ?? guessCategory(item.catalogItem.name)) === '調味料・油'
    if (item.kind === 'new') return guessCategory(item.name) === '調味料・油'
    return false
  }

  // 材料の冷蔵庫の行(この家にまだなければ null)。保存のときと同じく、食材マスタの品目か名前で探す
  function fridgeRowOf(item) {
    if (item.kind === 'existing') return fridgeById.get(item.ingredient?.id) ?? item.ingredient ?? null
    const list = ingredients ?? []
    if (item.kind === 'catalog') return list.find((i) => i.catalog_id === item.catalogItem?.id || normalizeName(i.name) === normalizeName(item.catalogItem?.name ?? '')) ?? null
    return list.find((i) => normalizeName(i.name) === normalizeName(item.name)) ?? null
  }

  const isStaple = (item) => Boolean(item.stapleOnSave || fridgeRowOf(item)?.is_staple)

  function setVague(item) {
    updateItem(item.key, { requiredQuantity: '', amountText: VAGUE_AMOUNT, needsCheck: false })
  }

  // 適量は具体的な量を在庫から引けないので、常備品(数えない)の登録を必須にする
  function toggleVague(item) {
    setStapleError('')
    if (isVagueAmount(item)) {
      updateItem(item.key, { requiredQuantity: 1, amountText: '', stapleOnSave: false })
      return
    }
    if (isStaple(item)) setVague(item)
    else setStapleAskKey(item.key)
  }

  async function registerStapleAndSetVague(item) {
    setStapleError('')
    const row = fridgeRowOf(item)
    if (!row) {
      // この家にまだない調味料: レシピを保存するときに、冷蔵庫の行を作って常備品にする
      updateItem(item.key, { requiredQuantity: '', amountText: VAGUE_AMOUNT, needsCheck: false, stapleOnSave: true })
      setStapleAskKey(null)
      return
    }
    setStapleBusy(true)
    const { error } = await supabase.from('ingredients').update({ is_staple: true }).eq('id', row.id)
    setStapleBusy(false)
    if (error) {
      setStapleError('常備品に登録できませんでした。もう一度お試しください')
      return
    }
    if (item.kind === 'existing') updateItem(item.key, { ingredient: { ...item.ingredient, is_staple: true } })
    setVague(item)
    setStapleAskKey(null)
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
                  onChange={(v) =>
                    updateItem(item.key, { requiredQuantity: v, needsCheck: false, ...(item.amountText === VAGUE_AMOUNT && Number(v) > 0 ? { amountText: '' } : {}) })
                  }
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
              {item.include && (
                <div className="flex flex-wrap items-center gap-1.5 pl-6">
                  {/* 必須・任意(既定は必須)。任意の材料は「作れる」の判定に入れず、作るときに使うか選べる */}
                  <button
                    type="button"
                    aria-pressed={Boolean(item.optional)}
                    aria-label={item.optional ? `${item.name}を必須の材料に戻す` : `${item.name}を任意の材料にする`}
                    title={item.optional ? 'あれば使う材料です。押すと必須に戻します' : '押すと「任意(あれば使う)」にします'}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      item.optional
                        ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                        : 'bg-background text-muted-foreground hover:border-sky-300 hover:text-sky-700'
                    }`}
                    onClick={() => updateItem(item.key, { optional: !item.optional })}
                  >
                    {item.optional ? '任意' : '必須'}
                  </button>
                  {item.optional && <span className="text-xs text-muted-foreground">あれば使う(なくても作れる)</span>}
                  {isSeasoning(item) && (
                  <button
                    type="button"
                    aria-pressed={isVagueAmount(item)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      isVagueAmount(item)
                        ? 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300'
                        : 'bg-background text-muted-foreground hover:border-violet-300 hover:text-violet-700'
                    }`}
                    onClick={() => toggleVague(item)}
                  >
                    適量
                  </button>
                  )}
                  {isSeasoning(item) && isVagueAmount(item) && (
                    <span className="text-xs text-muted-foreground">
                      {item.stapleOnSave ? '保存すると常備品に登録します。作ったときに在庫から引きません' : '常備品なので、作ったときに在庫から引きません'}
                    </span>
                  )}
                </div>
              )}
              {stapleAskKey === item.key && !isVagueAmount(item) && (
                <div role="alertdialog" aria-label="常備品に登録しますか" className="ml-6 flex flex-col gap-1.5 rounded-xl border border-violet-200 bg-violet-50 p-2.5 dark:border-violet-900 dark:bg-violet-950/40">
                  <p className="text-xs">
                    適量は量を数えられないため、常備品(在庫を数えない食材)にする必要があります。「{item.name}」を常備品に登録しますか?
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button type="button" size="sm" className="h-7 rounded-full text-xs" disabled={stapleBusy} onClick={() => registerStapleAndSetVague(item)}>
                      <InfinityIcon className="size-3.5" />
                      {stapleBusy ? '登録しています...' : '常備品に登録して適量にする'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 rounded-full text-xs" disabled={stapleBusy} onClick={() => setStapleAskKey(null)}>
                      やめる
                    </Button>
                  </div>
                  {stapleError && <p className="text-xs text-destructive">{stapleError}</p>}
                </div>
              )}
              {(item.rawText || item.needsCheck || item.note) && (
                <p className="pl-6 text-xs text-muted-foreground">
                  {item.rawText}
                  {item.note && <span className="ml-1">・状態: {item.note}</span>}
                  {item.needsCheck && item.include && !(Number(item.requiredQuantity) > 0) && !isVagueAmount(item) && (
                    <span className="ml-1 text-violet-700 dark:text-violet-400">
                      ・分量は「{item.amountText || '不明'}」のまま保存します(作るときに在庫から引く量を入れられます)
                    </span>
                  )}
                </p>
              )}
              {(() => {
                const est = item.include ? estimateFor(item, common) : null
                return est ? (
                  <div className="ml-6 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{est.text}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-full text-xs"
                      onClick={() => updateItem(item.key, { requiredQuantity: String(Math.round(est.quantity * 100) / 100), needsCheck: false })}
                    >
                      目安の量で入れる
                    </Button>
                  </div>
                ) : null
              })()}
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
