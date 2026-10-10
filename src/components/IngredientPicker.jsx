import { useMemo, useRef, useState } from 'react'
import { Infinity as InfinityIcon, Plus, Refrigerator } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useIngredientAliases } from '@/hooks/useIngredientAliases'
import { formatQuantity } from '@/lib/format'
import { CATEGORIES, CATEGORY_ICONS } from '@/lib/ingredientCategory'
import { buildNameIndex, matchIngredientName, nameKey, searchKeywords } from '@/lib/ingredientName'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const LONG_PRESS_MS = 550
const LONG_PRESS_MOVE_TOLERANCE = 8

const UNIT_PRESETS = ['個', 'g', 'ml', '本', 'パック', '袋', '枚']

// カテゴリと目印のアイコンは冷蔵庫・レシピの取り込みと共通(lib/ingredientCategory)

// カテゴリごとに(sort_orderで並んだ状態の)食材をグルーピングする。
// 出現順=カテゴリの表示順になる。
function groupByCategory(items) {
  const groups = []
  const indexByCategory = new Map()
  for (const item of items) {
    let group = indexByCategory.get(item.category)
    if (!group) {
      group = { category: item.category, items: [] }
      indexByCategory.set(item.category, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

// マスタ食材の一覧行。長押しするとカタログからの完全削除を確認する
// (通常のタップ選択とは別ジェスチャーなので、長押し発火後の後続クリックは握りつぶす)
function CatalogItemRow({ item, disabled, onSelect, onRequestDelete, keywords, stock, staple }) {
  const timerRef = useRef(null)
  const longPressFiredRef = useRef(false)
  const startPosRef = useRef({ x: 0, y: 0 })

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function handlePointerDown(e) {
    startPosRef.current = { x: e.clientX, y: e.clientY }
    longPressFiredRef.current = false
    clearTimer()
    // 共通の品目は削除できない(長押しで何もしない)。家庭で登録した品目だけ削除できる
    if (!onRequestDelete) return
    timerRef.current = setTimeout(() => {
      longPressFiredRef.current = true
      onRequestDelete(item)
    }, LONG_PRESS_MS)
  }

  function handlePointerMove(e) {
    const dx = e.clientX - startPosRef.current.x
    const dy = e.clientY - startPosRef.current.y
    if (Math.abs(dx) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(dy) > LONG_PRESS_MOVE_TOLERANCE) clearTimer()
  }

  function handlePointerUp() {
    clearTimer()
  }

  function handleClickCapture(e) {
    if (longPressFiredRef.current) {
      e.preventDefault()
      e.stopPropagation()
      longPressFiredRef.current = false
    }
  }

  return (
    <CommandItem
      value={item.name}
      keywords={keywords}
      disabled={disabled}
      onSelect={() => onSelect(item)}
      onPointerDown={handlePointerDown}
      // cmdk の CommandItem は内部で独自の onPointerMove
      // (ホバー選択用)を後から上書きするため、素の onPointerMove は
      // 効かない。onPointerMoveCapture ならキャプチャフェーズで先に
      // 発火するので、移動によるキャンセル判定はこちらで行う。
      onPointerMoveCapture={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={handleClickCapture}
      // メモのように素早く選べるタイル。最初の項目が選択色にならないよう、選択中の色は付けない
      className={`flex min-h-16 flex-col items-start gap-1 rounded-2xl! border bg-card p-2 text-left shadow-xs transition-transform active:scale-95 data-selected:bg-card [&>svg:last-child]:hidden ${
        stock || staple ? 'border-emerald-200 dark:border-emerald-900' : ''
      }`}
    >
      <span className="line-clamp-2 text-[13px] font-semibold leading-tight">{item.name}</span>
      <span className="mt-auto flex w-full items-center justify-between gap-1 text-[10px]">
        <span className="text-muted-foreground">{item.unit}</span>
        {staple ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-px font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            <InfinityIcon className="size-2.5" />
            常備
          </span>
        ) : stock ? (
          <span className="rounded-full bg-emerald-50 px-1.5 py-px font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">冷蔵庫に {stock}</span>
        ) : null}
      </span>
    </CommandItem>
  )
}

// 冷蔵庫への追加・レシピの材料タグ付けの両方で使う、食材の選択コンポーネント。
// 基本はマスタ食材(単位は食材ごとに自動決定)から選び、リストにないものだけ
// 例外的に自由入力(単位は手動選択)で追加できる。
// 選択(または新規作成)された食材オブジェクトを onSelect(ingredient) で返すだけで、
// 「その用途での数量」はここでは扱わず呼び出し側に任せる。
export function IngredientPicker({ open, onOpenChange, groupId, ingredients, onSelect, excludeIds = [], title = '食材を選ぶ' }) {
  const { catalog: rawCatalog, loading: catalogLoading } = useIngredientCatalog()
  const { aliases } = useIngredientAliases()
  // 同じ名前の品目が共通と家庭専用の両方にあれば、家庭専用を使う
  const catalog = useMemo(() => {
    const ownNames = new Set(rawCatalog.filter((c) => c.group_id).map((c) => c.name))
    return rawCatalog.filter((c) => c.group_id || !ownNames.has(c.name))
  }, [rawCatalog])
  // 食材名の照合と検索は、レシピの取り込みと同じ共通の処理(lib/ingredientName)を使う
  const nameIndex = useMemo(() => buildNameIndex({ ingredients, catalog: rawCatalog, aliases }), [ingredients, rawCatalog, aliases])
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newUnit, setNewUnit] = useState(UNIT_PRESETS[0])
  const [newCategory, setNewCategory] = useState(CATEGORIES[0])
  const [saving, setSaving] = useState(false)
  const [catalogSavingId, setCatalogSavingId] = useState(null)
  const [error, setError] = useState(null)
  const popupRef = useRef(null)
  const sectionRefs = useRef(new Map())
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletingCatalog, setDeletingCatalog] = useState(false)
  // 「リストにない食材を追加」で、似た食材が見つかったとき(使うか、新しく登録するかを選んでもらう)
  const [similar, setSimilar] = useState(null)

  // 冷蔵庫の行と食材マスタの品目を結び付ける(マスタの ID → 名前)。冷蔵庫にある食材も、カテゴリの中から選ぶ
  const fridgeByCatalog = useMemo(() => {
    const map = new Map()
    for (const c of catalog) {
      const row = nameIndex.fridgeByCatalog.get(c.id) ?? nameIndex.fridgeByKey.get(nameKey(c.name))
      if (row) map.set(c.id, row)
    }
    return map
  }, [catalog, nameIndex])

  // 食材マスタに結び付いていない冷蔵庫の行(以前に作られたもの)は「その他」に出す
  const catalogGroups = useMemo(() => {
    const linked = new Set([...fridgeByCatalog.values()].map((i) => i.id))
    const orphans = ingredients
      .filter((i) => !linked.has(i.id))
      .map((i) => ({ id: `fridge-${i.id}`, name: i.name, unit: i.unit, category: 'その他', fridgeRow: i }))
    return groupByCategory([...catalog, ...orphans])
  }, [catalog, ingredients, fridgeByCatalog])

  const trimmedSearch = search.trim()
  const isSearching = trimmedSearch.length > 0

  function reset() {
    setSearch('')
    setCreating(false)
    setNewUnit(UNIT_PRESETS[0])
    setNewCategory(CATEGORIES[0])
    setSimilar(null)
    setError(null)
  }

  function handleOpenChange(next) {
    if (!next) {
      reset()
      setDeleteTarget(null)
    }
    onOpenChange(next)
  }

  function handleSelectExisting(ingredient) {
    onSelect(ingredient)
    handleOpenChange(false)
  }

  // カテゴリの一覧から選んだとき: 冷蔵庫にすでにあればその行、なければ在庫0で作る
  function handlePick(item) {
    const existing = item.fridgeRow ?? fridgeByCatalog.get(item.id)
    if (existing) handleSelectExisting(existing)
    else handleSelectCatalog(item)
  }

  async function handleConfirmCatalogDelete() {
    if (!deleteTarget) return
    setDeletingCatalog(true)
    const { error: deleteError } = await supabase.from('ingredient_catalog').delete().eq('id', deleteTarget.id)
    setDeletingCatalog(false)
    if (deleteError) {
      console.error('食材マスタの削除に失敗しました', deleteError)
    }
    setDeleteTarget(null)
  }

  async function handleSelectCatalog(catalogItem) {
    setCatalogSavingId(catalogItem.id)
    setError(null)
    const { data, error: insertError } = await supabase
      .from('ingredients')
      .insert({
        group_id: groupId,
        catalog_id: catalogItem.id,
        name: catalogItem.name,
        unit: catalogItem.unit,
        quantity: 0,
      })
      .select()
      .single()
    setCatalogSavingId(null)

    if (insertError) {
      if (insertError.code === '23505') {
        // 一意制約違反 = 他のメンバーがほぼ同時に同じ食材を追加した等の競合。
        // 既存の行を取得してそれを選択したことにする。
        const { data: existing } = await supabase
          .from('ingredients')
          .select('*')
          .eq('group_id', groupId)
          .eq('name', catalogItem.name)
          .maybeSingle()
        if (existing) {
          onSelect(existing)
          handleOpenChange(false)
          return
        }
      }
      setError('追加に失敗しました。もう一度お試しください。')
      return
    }
    onSelect(data)
    handleOpenChange(false)
  }

  // 入力した名前を照合する: 同じ食材が登録済み(名前・別名が一致)ならそれを使い、
  // 似た食材があれば勝手に決めずに確認し、なければ新しく登録する
  function handleCreateRequest() {
    if (!trimmedSearch) return
    const match = matchIngredientName(trimmedSearch, nameIndex)
    if (match.status === 'auto') {
      handleUseSimilar(match.option)
      return
    }
    // 部分一致などで決めきれないときだけ確かめる。別の食材(干ししいたけ など)や似た食材がないときは、そのまま登録する
    if (match.status === 'choose' && match.candidates.length > 0) {
      setSimilar(match.candidates)
      return
    }
    handleCreate()
  }

  function handleUseSimilar(option) {
    setSimilar(null)
    if (option.kind === 'existing') handleSelectExisting(option.ingredient)
    else handleSelectCatalog(option.catalogItem)
  }

  async function handleCreate() {
    if (!trimmedSearch) return
    setSimilar(null)
    setSaving(true)
    setError(null)

    // 同名のマスタ食材(共通、または自分の家庭の品目)が既にあればそちらの単位・カテゴリを優先して使う
    const pickSameName = (rows) => rows?.find((c) => c.group_id) ?? rows?.find((c) => !c.group_id) ?? null
    const { data: sameName } = await supabase.from('ingredient_catalog').select('*').eq('name', trimmedSearch)
    let catalogItem = pickSameName(sameName)

    // 自分の家庭の品目が別カテゴリに入っている場合、選んだカテゴリへ移す(共通の品目は変更できないのでそのまま使う)
    if (catalogItem && catalogItem.group_id && catalogItem.category !== newCategory) {
      const { data: lastInTargetCategory } = await supabase
        .from('ingredient_catalog')
        .select('sort_order')
        .eq('category', newCategory)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      const movedSortOrder = (lastInTargetCategory?.sort_order ?? 0) + 10

      const { data: moved, error: moveError } = await supabase
        .from('ingredient_catalog')
        .update({ category: newCategory, sort_order: movedSortOrder })
        .eq('id', catalogItem.id)
        .select()
        .single()

      if (!moveError && moved) catalogItem = moved
    }

    if (!catalogItem) {
      const { data: lastInCategory } = await supabase
        .from('ingredient_catalog')
        .select('sort_order')
        .eq('category', newCategory)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextSortOrder = (lastInCategory?.sort_order ?? 0) + 10

      const { data: inserted, error: catalogError } = await supabase
        .from('ingredient_catalog')
        .insert({ name: trimmedSearch, unit: newUnit, category: newCategory, sort_order: nextSortOrder, group_id: groupId })
        .select()
        .single()

      if (catalogError) {
        if (catalogError.code === '23505') {
          // 他のメンバーがほぼ同時に同じ名前を登録した等の競合。既存行を再利用する。
          const { data: raced } = await supabase.from('ingredient_catalog').select('*').eq('name', trimmedSearch)
          catalogItem = pickSameName(raced)
        }
        if (!catalogItem) {
          setSaving(false)
          setError('食材の追加に失敗しました。もう一度お試しください。')
          return
        }
      } else {
        catalogItem = inserted
      }
    }

    const { data, error: insertError } = await supabase
      .from('ingredients')
      .insert({
        group_id: groupId,
        catalog_id: catalogItem.id,
        name: catalogItem.name,
        unit: catalogItem.unit,
        quantity: 0,
      })
      .select()
      .single()
    setSaving(false)

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: existing } = await supabase
          .from('ingredients')
          .select('*')
          .eq('group_id', groupId)
          .eq('name', catalogItem.name)
          .maybeSingle()
        if (existing) {
          onSelect(existing)
          handleOpenChange(false)
          return
        }
      }
      setError('追加に失敗しました。同じ名前の食材が既にあるかもしれません。')
      return
    }
    onSelect(data)
    handleOpenChange(false)
  }

  // カテゴリの札を押すと、その見出しまで一覧をスクロールする(開閉の手間をなくす)
  function jumpTo(category) {
    sectionRefs.current.get(category)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        // 開いたときに検索欄へフォーカスしない(iPhone で、どこかを一度タップするまで一覧がスクロールできなくなるため)
        initialFocus={popupRef}
        ref={popupRef}
        tabIndex={-1}
        className="mx-auto h-[88svh] data-[side=bottom]:h-[88svh] max-w-lg gap-0 overflow-hidden rounded-t-3xl border-2 border-b-0 border-sky-200 p-0 outline-none dark:border-sky-900"
      >
        {/* 冷蔵庫の扉の取っ手 */}
        <div className="flex shrink-0 items-center justify-center bg-sky-50 pt-2 pb-1 dark:bg-sky-950" aria-hidden="true">
          <span className="h-1.5 w-12 rounded-full bg-sky-200 dark:bg-sky-800" />
        </div>
        <div className="shrink-0 bg-sky-50 px-4 pb-3 dark:bg-sky-950">
          <SheetTitle className="flex items-center gap-2 pr-8 text-lg font-bold">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true">
              <Refrigerator className="size-4.5" strokeWidth={2.2} />
            </span>
            {title}
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs text-muted-foreground">
            タップするだけで選べます。単位は自動で決まります
          </SheetDescription>
        </div>

        {!creating ? (
          <Command shouldFilter className="min-h-0 flex-1 rounded-none! bg-background p-0">
            <div className="shrink-0 border-b bg-background px-3 pt-3 pb-2">
              <CommandInput placeholder="食材名で検索..." value={search} onValueChange={setSearch} />
              {!isSearching && (
                <div className="-mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3 pb-0.5" aria-label="カテゴリへ移動">
                  {catalogGroups.map(({ category }) => (
                    <button
                      key={category}
                      type="button"
                      className="flex shrink-0 items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium shadow-xs active:scale-95"
                      onClick={() => jumpTo(category)}
                    >
                      <span aria-hidden="true">{CATEGORY_ICONS[category] ?? '🍽️'}</span>
                      {category}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* 一覧のスクロールはここ1か所だけ(入れ子のスクロールをなくす) */}
            <CommandList className="max-h-none min-h-0 flex-1 touch-pan-y overscroll-contain px-3 pb-24 pt-1">
              <CommandEmpty>該当する食材が見つかりません</CommandEmpty>
              {!catalogLoading &&
                catalogGroups.map(({ category, items }) => (
                  <section
                    key={category}
                    ref={(el) => {
                      if (el) sectionRefs.current.set(category, el)
                      else sectionRefs.current.delete(category)
                    }}
                    className="scroll-mt-1"
                  >
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5">
                          <span className="text-base leading-none" aria-hidden="true">
                            {CATEGORY_ICONS[category] ?? '🍽️'}
                          </span>
                          {category}
                        </span>
                      }
                      className="p-0 pt-2 **:[[cmdk-group-items]]:grid **:[[cmdk-group-items]]:grid-cols-3 **:[[cmdk-group-items]]:gap-1.5 **:[[cmdk-group-heading]]:px-0.5"
                    >
                      {items.map((item) => {
                        const row = item.fridgeRow ?? fridgeByCatalog.get(item.id)
                        const qty = row && Number(row.quantity) > 0 ? `${formatQuantity(row.quantity)}${row.unit}` : null
                        return (
                          <CatalogItemRow
                            key={item.id}
                            item={item}
                            category={category}
                            // レシピで使っている材料は、もう一度は選べない
                            disabled={catalogSavingId === item.id || (row ? excludeIds.includes(row.id) : false)}
                            onSelect={handlePick}
                            onRequestDelete={item.group_id && !item.fridgeRow ? setDeleteTarget : null}
                            keywords={item.fridgeRow ? [nameKey(item.name)] : searchKeywords(item, nameIndex)}
                            stock={qty}
                            staple={Boolean(row?.is_staple)}
                          />
                        )
                      })}
                    </CommandGroup>
                  </section>
                ))}
            </CommandList>

            {error && <p className="shrink-0 px-4 py-2 text-sm text-destructive">{error}</p>}

            <div className="shrink-0 border-t bg-background px-3 pt-2 pb-safe">
              <button
                type="button"
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground"
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" />
                リストにない食材を追加
              </button>
            </div>
          </Command>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 pb-safe">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-ingredient-name">食材名</Label>
              <Input
                id="new-ingredient-name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>単位</Label>
              <div className="flex flex-wrap gap-2">
                {UNIT_PRESETS.map((unit) => (
                  <Button
                    key={unit}
                    type="button"
                    size="sm"
                    variant={newUnit === unit ? 'default' : 'outline'}
                    onClick={() => setNewUnit(unit)}
                  >
                    {unit}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>カテゴリ</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    size="sm"
                    variant={newCategory === category ? 'default' : 'outline'}
                    onClick={() => setNewCategory(category)}
                  >
                    <span className="text-base leading-none">{CATEGORY_ICONS[category]}</span>
                    {category}
                  </Button>
                ))}
              </div>
            </div>
            {similar && (
              <div role="alert" className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                <p className="font-medium">似ている食材があります。同じ食材ですか?</p>
                <div className="flex flex-wrap gap-2">
                  {similar.map((option) => (
                    <Button key={option.kind + (option.ingredient?.id ?? option.catalogItem?.id)} type="button" size="sm" variant="outline" onClick={() => handleUseSimilar(option)}>
                      「{option.name}」を使う
                    </Button>
                  ))}
                </div>
                <Button type="button" size="sm" variant="ghost" className="self-start" onClick={handleCreate} disabled={saving}>
                  別の食材として「{trimmedSearch}」を登録する
                </Button>
              </div>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                戻る
              </Button>
              <Button type="button" onClick={handleCreateRequest} disabled={saving || !trimmedSearch || Boolean(similar)}>
                {saving ? '追加中...' : '追加して選択'}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{deleteTarget?.name}」を完全に削除しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              食材マスタから削除され、他のメンバーの候補一覧にも表示されなくなります。この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deletingCatalog}>
              いいえ
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmCatalogDelete} disabled={deletingCatalog}>
              {deletingCatalog ? '削除中...' : 'はい'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
