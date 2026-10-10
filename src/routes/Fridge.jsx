import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Minus, Search, CalendarPlus, ChevronDown, Infinity as InfinityIcon, Hash } from 'lucide-react'
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
import { snapToStock } from '@/lib/quantity'
import { getBatchExpiry, getExpiryInfo, getExpiryState, describeExpiry, formatMonthDay, EXPIRY_KIND_LABEL, formatExpiryLabel } from '@/lib/shelfLife'
import { StockDialog } from '@/components/StockDialog'
import { categoryLook } from '@/lib/foodLook'

// g/ml のような細かい単位はまとめて増減、個数系は1ずつ増減する
const STEP_BY_UNIT = { g: 10, ml: 10 }
function stepFor(unit) {
  return STEP_BY_UNIT[unit] ?? 1
}

// 冷蔵庫に新しく入れるとき、最初から「常備品(数えない)」を選んでおくカテゴリ
const STAPLE_CATEGORIES = new Set(['調味料・油'])

const STATE_CLASS = {
  expired: 'text-destructive font-medium',
  soon: 'text-amber-600 dark:text-amber-400',
  ok: 'text-muted-foreground',
  none: 'text-muted-foreground/70',
}

// 一覧の行の期限の札
const STATE_PILL = {
  expired: 'bg-destructive text-white',
  soon: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  none: 'bg-muted text-muted-foreground',
}

// 期限切れ → 期限の近い順 → 期限未設定 の順。期限切れの食材も勝手には消さない
function compareRows(a, b) {
  if (a.expiry && b.expiry) return a.expiry.daysLeft - b.expiry.daysLeft
  if (a.expiry) return -1
  if (b.expiry) return 1
  return a.ingredient.name.localeCompare(b.ingredient.name, 'ja')
}

// 冷蔵庫の扉(取っ手つきの枠)。中身の一覧を包むだけ
function FridgeDoor({ children }) {
  return (
    <div className="overflow-hidden rounded-3xl border-2 border-sky-200 bg-card shadow-sm dark:border-sky-900">
      <div className="flex items-center justify-between bg-sky-50 px-4 py-1.5 dark:bg-sky-950" aria-hidden="true">
        <span className="h-1.5 w-12 rounded-full bg-sky-200 dark:bg-sky-800" />
        <span className="text-[10px] tracking-widest text-sky-600/80 dark:text-sky-400">COOKDOOR</span>
      </div>
      {children}
    </div>
  )
}

export function Fridge({ groupId }) {
  const { ingredients, loading, refresh, removeIngredient, dropLocal } = useIngredients(groupId)
  const [showEmpty, setShowEmpty] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  // 絞り込み(設計書 4 章): 'all' / 'expiring'(期限が3日以内・期限切れ)/ カテゴリ名
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState(() => (searchParams.get('filter') === 'expiring' ? 'expiring' : 'all'))
  const [stockTarget, setStockTarget] = useState(null)
  // 「追加」から開いたときだけ、常備品にする選択肢を出す
  const [stockOffer, setStockOffer] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState(false)
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
  const categoryOf = (ingredient) => catalogById.get(ingredient.catalog_id)?.category ?? 'その他'
  const categories = [...new Set(rows.filter((r) => Number(r.ingredient.quantity) > 0).map((r) => categoryOf(r.ingredient)))].sort((x, y) =>
    x.localeCompare(y, 'ja')
  )
  const filtered = rows.filter((r) =>
    filter === 'all' ? true : filter === 'expiring' ? r.expiry && r.expiry.daysLeft <= 3 : categoryOf(r.ingredient) === filter
  )
  const searching = query.trim() !== '' || filter !== 'all'
  const visible = (r) => Number(r.ingredient.quantity) > 0 || pinnedIds.has(r.ingredient.id)
  // 常備品は数を数えないので、冷蔵庫の一覧とは別の棚にまとめる
  const staples = filtered.filter((r) => r.ingredient.is_staple)
  const counted = filtered.filter((r) => !r.ingredient.is_staple)
  const inStock = searching ? counted : counted.filter(visible)
  const emptyRows = searching ? [] : counted.filter((r) => !visible(r))
  // 数を記録している調味料(まとめて常備品にできるもの)
  const countedSeasonings = ingredients.filter((i) => !i.is_staple && Number(i.quantity) > 0 && STAPLE_CATEGORIES.has(categoryOf(i)))

  async function setStaple(ids, value) {
    const { error } = await supabase.from('ingredients').update({ is_staple: value }).in('id', ids)
    if (error) console.error('常備品の切り替えに失敗しました', error)
    setBulkConfirm(false)
    refresh()
  }

  function handlePicked(ingredient) {
    setPinnedIds((prev) => new Set(prev).add(ingredient.id))
    setPickerOpen(false)
    // すでに常備品の食材は登録済みなので、常備品の棚で開いて見せるだけにする(重複して登録しない)
    if (ingredient.is_staple) {
      setExpandedId(ingredient.id)
      return
    }
    // 追加した食材は、そのまま量と期限を入れられるようにする(調味料などは常備品も選べる)
    setStockOffer(true)
    setStockTarget(ingredient)
  }

  function renderRow({ ingredient, expiry }) {
    return (
      <li key={ingredient.id}>
        <SwipeToDelete onDelete={() => removeIngredient(ingredient.id)}>
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xl ${categoryLook(categoryOf(ingredient), ingredient.name).bg} ${Number(ingredient.quantity) > 0 ? '' : 'grayscale opacity-60'}`}
              aria-hidden="true"
            >
              {categoryLook(categoryOf(ingredient), ingredient.name).emoji}
            </span>
            <button
              type="button"
              className="flex-1 min-w-0 text-left"
              onClick={() => setExpandedId((cur) => (cur === ingredient.id ? null : ingredient.id))}
              aria-expanded={expandedId === ingredient.id}
            >
              <p className="text-sm font-medium truncate flex items-center gap-1">
                {ingredient.name}
                <ChevronDown className={`size-3 shrink-0 text-muted-foreground transition-transform ${expandedId === ingredient.id ? 'rotate-180' : ''}`} />
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {formatQuantity(ingredient.quantity)} <span className="font-normal text-muted-foreground">{ingredient.unit}</span>
                </span>
                {Number(ingredient.quantity) > 0 && (
                  <span className={`rounded-full px-2 py-px text-[10px] font-medium ${STATE_PILL[getExpiryState(expiry)]}`}>{describeExpiry(expiry)}</span>
                )}
              </p>
            </button>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-8 rounded-full"
                onClick={() => {
                  setStockOffer(false)
                  setStockTarget(ingredient)
                }}
                aria-label="期限を入れて増やす"
              >
                <CalendarPlus className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="size-8 rounded-full"
                onClick={() => adjustQuantity(ingredient, -stepFor(ingredient.unit))}
                aria-label="減らす"
              >
                <Minus className="size-3.5" />
              </Button>
              <Button
                size="icon"
                className="size-8 rounded-full"
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
      <ul className="mx-3 mb-2 flex flex-col gap-1 rounded-xl bg-muted/60 px-3 py-2 text-xs" aria-label={`${ingredient.name}のロット`}>
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
        <li className="pt-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300"
            onClick={() => setStaple([ingredient.id], true)}
          >
            <InfinityIcon className="size-3.5" />
            常備品にする(数えない)
          </button>
        </li>
      </ul>
    )
  }

  async function adjustQuantity(ingredient, rawDelta) {
    // 1/3 を3回減らしたときなどに 0.000001 のような端数を残さない
    const delta = rawDelta < 0 ? -snapToStock(-rawDelta, ingredient.quantity) : rawDelta
    // 在庫の増減・ロットの記録・在庫0時の自動削除を1トランザクションで行う
    // (以前はクライアント側で複数回に分けて処理しており、連打や複数端末からの
    // 同時操作で更新が失われることがあった)
    const { data, error } = await supabase.rpc('adjust_stock', {
      p_ingredient_id: ingredient.id,
      p_delta: delta,
      p_dated_today: dateAsPurchaseDate,
      p_best_before: null,
      p_use_by: null,
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
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-1.5 text-xl font-bold">
            <span aria-hidden="true">🧊</span>
            冷蔵庫
          </h1>
          <p className="text-xs text-muted-foreground">いま入っている食材・{ingredients.filter((i) => Number(i.quantity) > 0).length}品</p>
        </div>
        <Button size="sm" className="rounded-full" onClick={() => setPickerOpen(true)}>
          <Plus className="size-4" />
          追加
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          className="h-10 rounded-full pl-9"
          placeholder="食材を検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="冷蔵庫の絞り込み">
        {[
          { id: 'all', label: 'すべて', emoji: '🧊' },
          { id: 'expiring', label: '期限が近い', emoji: '⏰' },
          ...categories.map((c) => ({ id: c, label: c, emoji: categoryLook(c).emoji })),
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${filter === f.id ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-sm' : 'bg-card text-muted-foreground'}`}
            onClick={() => setFilter(f.id)}
          >
            <span aria-hidden="true">{f.emoji}</span>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-3 py-2.5">
        <span className="text-xl" aria-hidden="true">📅</span>
        <div className="flex flex-1 flex-col">
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
        <p className="py-10 text-center text-sm text-muted-foreground">まだ食材がありません。「追加」から登録しましょう。</p>
      ) : (
        <>
          {inStock.length > 0 ? (
            <FridgeDoor>
              <ul className="flex flex-col divide-y divide-border">{inStock.map(renderRow)}</ul>
            </FridgeDoor>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">在庫のある食材はありません。</p>
          )}
          {(staples.length > 0 || (!searching && countedSeasonings.length > 0)) && (
            <section className="flex flex-col gap-2 rounded-3xl border-2 border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/30" aria-label="常備品">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <InfinityIcon className="size-4 text-violet-600" />
                  常備品
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">{staples.length}</span>
                </h2>
                <span className="text-[11px] text-muted-foreground">数えずに「ある」とみなします</span>
              </div>
              {staples.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {staples.map(({ ingredient }) => (
                    <li key={ingredient.id}>
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium ${expandedId === ingredient.id ? 'border-violet-400' : ''}`}
                        onClick={() => setExpandedId((cur) => (cur === ingredient.id ? null : ingredient.id))}
                        aria-expanded={expandedId === ingredient.id}
                      >
                        <span aria-hidden="true">{categoryLook(categoryOf(ingredient), ingredient.name).emoji}</span>
                        {ingredient.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {(() => {
                const open = staples.find((r) => r.ingredient.id === expandedId)?.ingredient
                return open ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-xs">
                    <span>{open.name}は常備品です</span>
                    <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => setStaple([open.id], false)}>
                      <Hash className="size-3.5" />
                      数を記録する
                    </Button>
                  </div>
                ) : null
              })()}
              {!searching && countedSeasonings.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-xs">
                  <span className="text-muted-foreground">
                    数を記録している調味料が{countedSeasonings.length}品あります
                  </span>
                  {bulkConfirm ? (
                    <span className="flex gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(false)}>
                        やめる
                      </Button>
                      <Button size="sm" className="h-7 rounded-full text-xs" onClick={() => setStaple(countedSeasonings.map((i) => i.id), true)}>
                        {countedSeasonings.map((i) => i.name).slice(0, 3).join('・')}
                        {countedSeasonings.length > 3 ? 'など' : ''}を常備品に
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => setBulkConfirm(true)}>
                      まとめて常備品にする
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
          {emptyRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowEmpty((v) => !v)}>
                {showEmpty ? '在庫なしの食材を隠す' : `在庫なしの食材(${emptyRows.length})を表示`}
              </Button>
              {showEmpty && (
                <ul className="flex flex-col divide-y divide-border rounded-2xl border border-dashed opacity-80">{emptyRows.map(renderRow)}</ul>
              )}
            </div>
          )}
        </>
      )}

      <StockDialog
        ingredient={stockTarget}
        defaultQuantity={stockTarget ? stepFor(stockTarget.unit) : 1}
        datedToday={dateAsPurchaseDate}
        offerStaple={stockOffer}
        // 調味料・油は常備品を初期選択にする。ただし在庫を数えている食材を選び直したときは数を記録するのまま
        stapleDefault={Boolean(stockTarget) && !(Number(stockTarget.quantity) > 0) && STAPLE_CATEGORIES.has(categoryOf(stockTarget))}
        onSaved={refresh}
        onClose={() => setStockTarget(null)}
      />

      <IngredientPicker
        title="冷蔵庫に入れる"
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        groupId={groupId}
        ingredients={ingredients}
        onSelect={handlePicked}
      />
    </div>
  )
}
