import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Minus, Search, CalendarPlus, ChevronDown, Infinity as InfinityIcon, ShoppingCart, X } from 'lucide-react'
import { useIngredients } from '@/hooks/useIngredients'
import { useIngredientBatches } from '@/hooks/useIngredientBatches'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { IngredientPicker } from '@/components/IngredientPicker'
import { SwipeToDelete } from '@/components/SwipeToDelete'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/supabaseClient'
import { formatQuantity } from '@/lib/format'
import { snapToStock } from '@/lib/quantity'
import { getBatchExpiry, getExpiryInfo, getExpiryState, describeExpiry, formatMonthDay, EXPIRY_KIND_LABEL, formatExpiryLabel } from '@/lib/shelfLife'
import { StockDialog } from '@/components/StockDialog'
import { BatchStockDialog } from '@/components/BatchStockDialog'
import { categoryLook } from '@/lib/foodLook'
import { addToShoppingList } from '@/lib/shopping'

// g/ml のような細かい単位はまとめて増減、個数系は1ずつ増減する
const STEP_BY_UNIT = { g: 10, ml: 10 }
function stepFor(unit) {
  return STEP_BY_UNIT[unit] ?? 1
}

// 使った量のボタン(各行に常に出す)。単位と残りの量で変える。押すとゲージがその分だけ減る
// - g・ml など: 50・100
// - 個数系で残りが少ない(3以下): ¼・½・1(キャベツ1玉の半分など)
// - 個数系で残りが多い: 1・2・3(卵など)
// 残り以上のボタンは出さない(残りすべては、どの食材でも共通の「全部」ボタン)
const BULK_UNITS = new Set(['g', 'ml', 'cc'])
const FRACTION_LABEL = { 0.25: '¼', 0.5: '½', 0.75: '¾' }
export function quickUses(unit, quantity) {
  const q = Number(quantity) || 0
  if (q <= 0) return []
  const steps = BULK_UNITS.has(unit) ? [50, 100] : q <= 3 ? [0.25, 0.5, 1] : [1, 2, 3]
  return steps.filter((v) => v < q - 1e-9).map((v) => ({ label: `−${FRACTION_LABEL[v] ?? v}${unit}`, amount: `${FRACTION_LABEL[v] ?? v}${unit}`, value: v }))
}

// 在庫のゲージ: 最後に在庫を増やしたときの量(full_quantity, migration 033)を満タンとして、残りの割合を出す
export function stockGauge(ingredient) {
  const q = Math.max(0, Number(ingredient.quantity) || 0)
  const full = Math.max(Number(ingredient.full_quantity) || 0, q)
  const ratio = full > 0 ? q / full : 0
  // 個数系で満タンが12以下なら、1つごとに目盛りを付ける(½・¼ 減ったのが見える)
  const ticks = !BULK_UNITS.has(ingredient.unit) && full > 1 && full <= 12 && Number.isInteger(full) ? full : 0
  // 色: 50%より多い = 黄色、50%以下 = オレンジ、25%以下 = 赤
  return { quantity: q, full, ratio, ticks, level: ratio > 0.5 ? 'high' : ratio > 0.25 ? 'mid' : 'low' }
}
const GAUGE_COLOR = { high: 'bg-yellow-400', mid: 'bg-orange-500', low: 'bg-red-500' }

function StockGauge({ ingredient }) {
  const g = stockGauge(ingredient)
  const percent = Math.round(g.ratio * 100)
  return (
    <div className="flex items-center gap-2">
      {/* 横並びの中で幅だけ伸ばす(縦並びの flex-1 だと高さが0になる)。下地は白いカードの上でも見える色 */}
      <div
        className="relative h-3 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
        role="meter"
        aria-label={`${ingredient.name}の残り`}
        aria-valuemin={0}
        aria-valuemax={g.full}
        aria-valuenow={g.quantity}
        aria-valuetext={`${formatQuantity(g.quantity)}${ingredient.unit}(${percent}%)`}
      >
        <div className={`h-full rounded-full transition-[width] duration-300 ${GAUGE_COLOR[g.level]}`} style={{ width: `${g.ratio * 100}%` }} />
        {g.ticks > 0 &&
          Array.from({ length: g.ticks - 1 }, (_, i) => (
            <span key={i} className="absolute inset-y-0 w-0.5 bg-white/90 dark:bg-stone-900/80" style={{ left: `${((i + 1) / g.ticks) * 100}%` }} aria-hidden="true" />
          ))}
      </div>
      <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground" aria-hidden="true">
        {percent}%
      </span>
    </div>
  )
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
  const [expandedId, setExpandedId] = useState(null)
  // 絞り込み(設計書 4 章): 'all' / 'expiring'(期限が3日以内・期限切れ)/ カテゴリ名
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState(() => (searchParams.get('filter') === 'expiring' ? 'expiring' : 'all'))
  const [stockTarget, setStockTarget] = useState(null)
  // 「追加」から開いたときだけ、常備品にする選択肢を出す
  const [stockOffer, setStockOffer] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState(false)
  // 追加でまとめて選んだ食材(2品以上)
  const [batchTargets, setBatchTargets] = useState(null)
  // 追加のダイアログで保存した食材の ID(保存せずに閉じた食材を片付けるため)
  const savedIds = useRef(new Set())
  // 「追加」で選んだ食材は、在庫0でも通常の一覧に出す(このあと「＋」で増やすため)
  const { batches } = useIngredientBatches(groupId)
  const { catalog } = useIngredientCatalog()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  // 「全部」を押して、在庫を0にするのを待っている食材({ id, name })。待っている間は一覧に出さない
  const [pendingAll, setPendingAll] = useState(null)

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
  const visible = (r) => Number(r.ingredient.quantity) > 0
  // 常備品は数を数えないので、冷蔵庫の一覧とは別の棚にまとめる
  const staples = filtered.filter((r) => r.ingredient.is_staple)
  const counted = filtered.filter((r) => !r.ingredient.is_staple)
  // 在庫0の食材(レシピの材料として残っている行など)は、検索中も含めて冷蔵庫には出さない
  const inStock = counted.filter((r) => visible(r) && r.ingredient.id !== pendingAll?.id)
  // 数を記録している調味料(まとめて常備品にできるもの)
  const countedSeasonings = ingredients.filter((i) => !i.is_staple && Number(i.quantity) > 0 && STAPLE_CATEGORIES.has(categoryOf(i)))

  // 常備品から外す。在庫を数えていない(0)なら冷蔵庫から片付ける(safeDiscard: レシピで使う食材は残す)。
  // 在庫が残っていれば、数量もロットもそのままで、数を記録する食材として一覧に戻る
  async function unstaple(ingredient) {
    const { error } = await supabase.from('ingredients').update({ is_staple: false }).eq('id', ingredient.id)
    if (error) {
      console.error('常備品から外せませんでした', error)
      return
    }
    setExpandedId(null)
    if (!(Number(ingredient.quantity) > 0)) await safeDiscard(ingredient.id)
    refresh()
  }

  // 常備品がなくなった: 買い物リストに入れる(常備品以外は自動で入れない)
  const [shoppingError, setShoppingError] = useState('')
  async function runOut(ingredient) {
    setShoppingError('')
    const result = await addToShoppingList([ingredient.id])
    if (result.error) setShoppingError(result.error)
    refresh()
  }

  async function setStaple(ids, value) {
    const { error } = await supabase.from('ingredients').update({ is_staple: value }).in('id', ids)
    if (error) console.error('常備品の切り替えに失敗しました', error)
    setBulkConfirm(false)
    refresh()
  }

  // 追加で選んだまま、量も常備品も決めずに閉じた食材は冷蔵庫に残さない(選んだ時点で在庫0の行ができるため)。
  // 別の端末がその間に在庫を入れていることもあるので、消す直前の状態で確かめる:
  // いまも在庫0で常備品でなく、どのレシピでも使っていない行だけを、在庫0を条件に消す
  async function safeDiscard(id) {
    const { data: row } = await supabase.from('ingredients').select('quantity, is_staple, restock_requested_at').eq('id', id).maybeSingle()
    // 買い物リストに入っている食材は消さない(常備品から外したときなど)
    if (!row || Number(row.quantity) > 0 || row.is_staple || row.restock_requested_at) return
    const { count, error: countError } = await supabase
      .from('recipe_ingredients')
      .select('ingredient_id', { count: 'exact', head: true })
      .eq('ingredient_id', id)
    if (countError || count == null || count > 0) return
    const { error } = await supabase.from('ingredients').delete().eq('id', id).eq('quantity', 0).eq('is_staple', false).is('restock_requested_at', null)
    if (error) console.error('使わなかった食材を片付けられませんでした', error)
    refresh()
  }

  function discardUnused(list) {
    for (const i of list) {
      if (!(Number(i.quantity) > 0) && !i.is_staple) safeDiscard(i.id)
    }
  }

  // 追加で複数選んだとき。1品ならこれまでどおりのダイアログ、2品以上はまとめて入れるダイアログ
  function handlePickedMany(list) {
    if (list.length === 1) {
      handlePicked(list[0])
      return
    }
    setPickerOpen(false)
    setBatchTargets(list)
  }

  function handlePicked(ingredient) {
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
          {Number(ingredient.quantity) > 0 && (
            // 残りのゲージと、使った量をワンタップで減らすボタン(開かなくても押せる)。「全部」はどの食材も同じで、押すと冷蔵庫から消える
            <div className="flex flex-col gap-1.5 px-3 pb-2.5 pl-[3.875rem]">
              <StockGauge ingredient={ingredient} />
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${ingredient.name}を使った量`}>
                {quickUses(ingredient.unit, ingredient.quantity).map((u) => (
                  <button
                    key={u.label}
                    type="button"
                    className="rounded-full border bg-background px-3 py-1 text-xs font-semibold tabular-nums transition-colors hover:border-primary hover:bg-primary/10 active:scale-95"
                    onClick={() => adjustQuantity(ingredient, -u.value)}
                    aria-label={`${u.amount}使った(${ingredient.name})`}
                  >
                    {u.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="ml-auto rounded-full border border-destructive/30 px-3 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/5 active:scale-95"
                  onClick={() => finishAll(ingredient)}
                  aria-label={`全部使った(${ingredient.name})`}
                >
                  全部
                </button>
              </div>
            </div>
          )}
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
          <Link
            to={`/settings/aliases?keep=${ingredient.id}`}
            className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-background px-2.5 py-1 font-medium text-muted-foreground ring-1 ring-border hover:text-foreground"
          >
            ほかの食材とまとめる
          </Link>
        </li>
      </ul>
    )
  }

  // 「全部」: 押したらすぐ冷蔵庫の一覧から消し、少し待ってから在庫を0にする(その間は「取り消す」で元どおり。DB は変えていない)。
  // 0 にするときの量は、その時点の在庫(別の端末で変わっていても残りすべて)。
  // レシピで使う食材は行が残り(在庫0は冷蔵庫に出さない)、レシピの材料・調理の記録はそのまま
  const UNDO_MS = 5000
  const pendingTimer = useRef(null)
  const latestIngredients = useRef(ingredients)
  latestIngredients.current = ingredients

  async function commitAll(id) {
    const row = latestIngredients.current.find((i) => i.id === id)
    const qty = Number(row?.quantity) || 0
    if (qty <= 0) return
    const { data, error } = await supabase.rpc('adjust_stock', { p_ingredient_id: id, p_delta: -qty, p_dated_today: true, p_best_before: null, p_use_by: null })
    if (error) {
      console.error('数量の更新に失敗しました', error)
      refresh()
      return
    }
    if (data?.[0]?.deleted) dropLocal(id)
    else refresh()
  }
  function flushPendingAll() {
    if (!pendingTimer.current) return
    clearTimeout(pendingTimer.current.timer)
    const { id } = pendingTimer.current
    pendingTimer.current = null
    commitAll(id)
  }
  function finishAll(ingredient) {
    flushPendingAll()
    const timer = setTimeout(() => {
      pendingTimer.current = null
      setPendingAll(null)
      commitAll(ingredient.id)
    }, UNDO_MS)
    pendingTimer.current = { id: ingredient.id, timer }
    setPendingAll({ id: ingredient.id, name: ingredient.name })
  }
  function undoAll() {
    if (pendingTimer.current) clearTimeout(pendingTimer.current.timer)
    pendingTimer.current = null
    setPendingAll(null)
  }
  // 画面を離れるときは、待っている「全部」をすぐ反映する
  useEffect(() => () => flushPendingAll(), []) // eslint-disable-line react-hooks/exhaustive-deps

  async function adjustQuantity(ingredient, rawDelta) {
    // 1/3 を3回減らしたときなどに 0.000001 のような端数を残さない
    const delta = rawDelta < 0 ? -snapToStock(-rawDelta, ingredient.quantity) : rawDelta
    // 在庫の増減・ロットの記録・在庫0時の自動削除を1トランザクションで行う
    // (以前はクライアント側で複数回に分けて処理しており、連打や複数端末からの
    // 同時操作で更新が失われることがあった)
    const { data, error } = await supabase.rpc('adjust_stock', {
      p_ingredient_id: ingredient.id,
      p_delta: delta,
      // ＋で増やした分は今日買ったものとして記録する(期限の目安に使う)
      p_dated_today: true,
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
                        {ingredient.restock_requested_at && <ShoppingCart className="size-3 text-amber-600" aria-label="買い物リストに入っています" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {(() => {
                const open = staples.find((r) => r.ingredient.id === expandedId)?.ingredient
                return open ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-xs">
                    <span>{open.restock_requested_at ? `${open.name}は買い物リストに入っています` : `${open.name}は常備品です`}</span>
                    <span className="flex gap-1.5">
                      {!open.restock_requested_at && (
                        <Button size="sm" className="h-7 rounded-full text-xs" onClick={() => runOut(open)}>
                          <ShoppingCart className="size-3.5" />
                          なくなった
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => unstaple(open)}>
                        <X className="size-3.5" />
                        常備品から外す
                      </Button>
                    </span>
                  </div>
                ) : null
              })()}
              {shoppingError && <p className="text-xs text-destructive">{shoppingError}</p>}
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
        </>
      )}

      <StockDialog
        ingredient={stockTarget}
        defaultQuantity={stockTarget ? stepFor(stockTarget.unit) : 1}
        datedToday
        offerStaple={stockOffer}
        // 調味料・油は常備品を初期選択にする。ただし在庫を数えている食材を選び直したときは数を記録するのまま
        stapleDefault={Boolean(stockTarget) && !(Number(stockTarget.quantity) > 0) && STAPLE_CATEGORIES.has(categoryOf(stockTarget))}
        onSaved={() => {
          if (stockTarget) savedIds.current.add(stockTarget.id)
          refresh()
        }}
        onClose={() => {
          if (stockOffer && stockTarget && !savedIds.current.has(stockTarget.id)) discardUnused([stockTarget])
          savedIds.current = new Set()
          setStockTarget(null)
        }}
      />

      <IngredientPicker
        title="冷蔵庫に入れる"
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        groupId={groupId}
        ingredients={ingredients}
        onSelect={handlePicked}
        multiple
        onSelectMany={handlePickedMany}
      />

      {batchTargets && (
        <BatchStockDialog
          ingredients={batchTargets}
          datedToday
          isStapleCategory={(i) => STAPLE_CATEGORIES.has(categoryOf(i))}
          onClose={() => {
            discardUnused(batchTargets.filter((i) => !savedIds.current.has(i.id)))
            savedIds.current = new Set()
            setBatchTargets(null)
          }}
          onSaved={(keptIds) => {
            for (const id of keptIds) savedIds.current.add(id)
            refresh()
          }}
        />
      )}
      {pendingAll && (
        <div
          role="status"
          className="fixed inset-x-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-foreground px-4 py-3 text-sm text-background shadow-lg"
          style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <span className="min-w-0 truncate">「{pendingAll.name}」を全部使いました</span>
          <button type="button" className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-bold text-foreground" onClick={undoAll}>
            取り消す
          </button>
        </div>
      )}
    </div>
  )
}
