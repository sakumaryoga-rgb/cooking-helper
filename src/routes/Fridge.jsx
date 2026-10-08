import { useMemo, useState } from 'react'
import { Plus, Minus, Search, CalendarPlus, ChevronDown } from 'lucide-react'
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
import { getBatchExpiry, getExpiryInfo, getExpiryState, describeExpiry, formatMonthDay, EXPIRY_KIND_LABEL, formatExpiryLabel } from '@/lib/shelfLife'
import { StockDialog } from '@/components/StockDialog'

// g/ml のような細かい単位はまとめて増減、個数系は1ずつ増減する
const STEP_BY_UNIT = { g: 10, ml: 10 }
function stepFor(unit) {
  return STEP_BY_UNIT[unit] ?? 1
}

const STATE_CLASS = {
  expired: 'text-destructive font-medium',
  soon: 'text-amber-600 dark:text-amber-400',
  ok: 'text-muted-foreground',
  none: 'text-muted-foreground/70',
}

// 期限切れ → 期限の近い順 → 期限未設定 の順。期限切れの食材も勝手には消さない
function compareRows(a, b) {
  if (a.expiry && b.expiry) return a.expiry.daysLeft - b.expiry.daysLeft
  if (a.expiry) return -1
  if (b.expiry) return 1
  return a.ingredient.name.localeCompare(b.ingredient.name, 'ja')
}

export function Fridge({ groupId }) {
  const { ingredients, loading, removeIngredient, dropLocal } = useIngredients(groupId)
  const [showEmpty, setShowEmpty] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [stockTarget, setStockTarget] = useState(null)
  // 「追加」で選んだ食材は、在庫0でも通常の一覧に出す(このあと「＋」で増やすため)
  const [pinnedIds, setPinnedIds] = useState(() => new Set())
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

    list.sort(compareRows)

    return list
  }, [ingredients, query, batchesByIngredient, catalogById])

  // 在庫0の食材(レシピの材料として残っているもの)は折りたたむ。検索中はすべて出す
  const searching = query.trim() !== ''
  const visible = (r) => Number(r.ingredient.quantity) > 0 || r.ingredient.is_staple || pinnedIds.has(r.ingredient.id)
  const inStock = searching ? rows : rows.filter(visible)
  const emptyRows = searching ? [] : rows.filter((r) => !visible(r))

  function handlePicked(ingredient) {
    setPinnedIds((prev) => new Set(prev).add(ingredient.id))
    setPickerOpen(false)
    // 追加した食材は、そのまま量と期限を入れられるようにする
    setStockTarget(ingredient)
  }

  function renderRow({ ingredient, expiry }) {
    return (
      <li key={ingredient.id}>
        <SwipeToDelete onDelete={() => removeIngredient(ingredient.id)}>
          <div className="flex items-center gap-3 px-3 py-2.5">
            <button
              type="button"
              className="flex-1 min-w-0 text-left"
              onClick={() => setExpandedId((cur) => (cur === ingredient.id ? null : ingredient.id))}
              aria-expanded={expandedId === ingredient.id}
            >
              <p className="text-sm font-medium truncate flex items-center gap-1">
                {ingredient.name}
                {ingredient.is_staple && <span className="text-xs font-normal text-muted-foreground">常備品</span>}
                <ChevronDown className={`size-3 shrink-0 text-muted-foreground transition-transform ${expandedId === ingredient.id ? 'rotate-180' : ''}`} />
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span>
                  {formatQuantity(ingredient.quantity)} {ingredient.unit}
                </span>
                {Number(ingredient.quantity) > 0 && (
                  <span className={STATE_CLASS[getExpiryState(expiry)]}>・{describeExpiry(expiry)}</span>
                )}
              </p>
            </button>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => setStockTarget(ingredient)}
                aria-label="期限を入れて増やす"
              >
                <CalendarPlus className="size-3.5" />
              </Button>
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
        {expandedId === ingredient.id && renderLots(ingredient)}
      </li>
    )
  }

  // 同じ食材でも購入日・期限の違うロットを分けて表示する(次に使うロットが先頭)
  function renderLots(ingredient) {
    const lots = (batchesByIngredient.get(ingredient.id) ?? [])
      .filter((b) => Number(b.quantity) > 0)
      .map((b) => ({ batch: b, info: getBatchExpiry(b, ingredient, catalogById) }))
      .sort((x, y) => (x.info && y.info ? x.info.expiryDate - y.info.expiryDate : x.info ? -1 : y.info ? 1 : 0))
    const recorded = lots.reduce((sum, l) => sum + Number(l.batch.quantity), 0)
    const unrecorded = Math.round((Number(ingredient.quantity) - recorded) * 100) / 100
    return (
      <ul className="flex flex-col gap-1 bg-muted/50 px-3 py-2 text-xs" aria-label={`${ingredient.name}のロット`}>
        {lots.length === 0 && unrecorded <= 0 && <li className="text-muted-foreground">在庫はありません</li>}
        {lots.map(({ batch, info }) => (
          <li key={batch.id} className="flex items-center justify-between gap-2">
            <span>
              {formatQuantity(batch.quantity)}
              {ingredient.unit}・{batch.added_on ? `${formatMonthDay(new Date(`${batch.added_on}T00:00:00`))}購入` : '購入日なし'}
            </span>
            <span className={STATE_CLASS[getExpiryState(info)]}>
              {info ? `${EXPIRY_KIND_LABEL[info.kind]} ${formatMonthDay(info.expiryDate)}・${formatExpiryLabel(info.daysLeft)}` : '期限未設定'}
            </span>
          </li>
        ))}
        {unrecorded > 0 && (
          <li className="text-muted-foreground">
            {formatQuantity(unrecorded)}
            {ingredient.unit}・ロットの記録なし
          </li>
        )}
      </ul>
    )
  }

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
      dropLocal(ingredient.id)
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
        <>
          {inStock.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border">{inStock.map(renderRow)}</ul>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">在庫のある食材はありません。</p>
          )}
          {emptyRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowEmpty((v) => !v)}>
                {showEmpty ? '在庫なしの食材を隠す' : `在庫なしの食材(${emptyRows.length})を表示`}
              </Button>
              {showEmpty && (
                <ul className="flex flex-col divide-y divide-border rounded-lg border opacity-80">{emptyRows.map(renderRow)}</ul>
              )}
            </div>
          )}
        </>
      )}

      <StockDialog
        ingredient={stockTarget}
        defaultQuantity={stockTarget ? stepFor(stockTarget.unit) : 1}
        datedToday={dateAsPurchaseDate}
        onClose={() => setStockTarget(null)}
      />

      <IngredientPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        groupId={groupId}
        ingredients={ingredients}
        onSelect={handlePicked}
      />
    </div>
  )
}
