import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { formatQuantity } from '@/lib/format'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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

// カテゴリごとの目印アイコン(hyponex 野菜大辞典の写真は著作物のため使えないので、
// 一目で見分けられる絵文字アイコンを代わりに割り当てている)
const CATEGORY_ICONS = {
  肉類: '🥩',
  魚介類: '🐟',
  果菜類: '🍅',
  葉茎菜類: '🥬',
  根菜類: '🥕',
  キノコ類: '🍄',
  果物: '🍎',
  '卵・乳製品': '🥚',
  大豆製品: '🫘',
  穀物: '🌾',
  '麺・パン': '🍞',
  '調味料・油': '🧂',
}

const CATEGORIES = Object.keys(CATEGORY_ICONS)

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
function CatalogItemRow({ item, category, isSearching, disabled, onSelect, onRequestDelete }) {
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
    >
      {isSearching && <span className="text-base leading-none">{CATEGORY_ICONS[category] ?? '🍽️'}</span>}
      <span className="flex-1">{item.name}</span>
      <span className="text-muted-foreground text-xs">{item.unit}</span>
    </CommandItem>
  )
}

// 冷蔵庫への追加・レシピの材料タグ付けの両方で使う、食材の選択コンポーネント。
// 基本はマスタ食材(単位は食材ごとに自動決定)から選び、リストにないものだけ
// 例外的に自由入力(単位は手動選択)で追加できる。
// 選択(または新規作成)された食材オブジェクトを onSelect(ingredient) で返すだけで、
// 「その用途での数量」はここでは扱わず呼び出し側に任せる。
export function IngredientPicker({ open, onOpenChange, groupId, ingredients, onSelect, excludeIds = [] }) {
  const { catalog, loading: catalogLoading } = useIngredientCatalog()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newUnit, setNewUnit] = useState(UNIT_PRESETS[0])
  const [newCategory, setNewCategory] = useState(CATEGORIES[0])
  const [saving, setSaving] = useState(false)
  const [catalogSavingId, setCatalogSavingId] = useState(null)
  const [error, setError] = useState(null)
  const [openCategories, setOpenCategories] = useState(() => new Set())
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletingCatalog, setDeletingCatalog] = useState(false)

  const availableIngredients = useMemo(
    () => ingredients.filter((i) => !excludeIds.includes(i.id)),
    [ingredients, excludeIds]
  )

  // すでにこのグループの冷蔵庫にある食材は、カタログ側の一覧から除外する
  // (excludeIds ではなく ingredients 全件で判定: レシピ下書き中のタグ付け除外とは別軸のため)
  const groupCatalogIds = useMemo(
    () => new Set(ingredients.map((i) => i.catalog_id).filter(Boolean)),
    [ingredients]
  )
  const groupNames = useMemo(() => new Set(ingredients.map((i) => i.name)), [ingredients])

  const availableCatalog = useMemo(
    () => catalog.filter((c) => !groupCatalogIds.has(c.id) && !groupNames.has(c.name)),
    [catalog, groupCatalogIds, groupNames]
  )

  const catalogGroups = useMemo(() => groupByCategory(availableCatalog), [availableCatalog])

  const trimmedSearch = search.trim()
  const isSearching = trimmedSearch.length > 0

  function reset() {
    setSearch('')
    setCreating(false)
    setNewUnit(UNIT_PRESETS[0])
    setNewCategory(CATEGORIES[0])
    setError(null)
    setOpenCategories(new Set())
  }

  function toggleCategory(category) {
    setOpenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
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

  async function handleCreate() {
    if (!trimmedSearch) return
    setSaving(true)
    setError(null)

    // 同名のマスタ食材が既にあればそちらの単位・カテゴリを優先して使う
    const { data: existingCatalog } = await supabase
      .from('ingredient_catalog')
      .select('*')
      .eq('name', trimmedSearch)
      .maybeSingle()

    let catalogItem = existingCatalog

    // 既存のマスタ食材が別カテゴリに入っている場合、選んだカテゴリへ移す
    // (以前は既存行をそのまま使い回してしまい、選択したカテゴリが無視されるバグがあった)
    if (catalogItem && catalogItem.category !== newCategory) {
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
        .insert({ name: trimmedSearch, unit: newUnit, category: newCategory, sort_order: nextSortOrder })
        .select()
        .single()

      if (catalogError) {
        if (catalogError.code === '23505') {
          // 他のメンバーがほぼ同時に同じ名前を登録した等の競合。既存行を再利用する。
          const { data: raced } = await supabase
            .from('ingredient_catalog')
            .select('*')
            .eq('name', trimmedSearch)
            .maybeSingle()
          catalogItem = raced
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

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>食材を選択</DialogTitle>
          <DialogDescription>食材を選ぶと単位は自動で設定されます(長押しでマスタから完全削除)</DialogDescription>
        </DialogHeader>

        {!creating ? (
          <>
            <Command shouldFilter>
              <CommandInput placeholder="食材名で検索..." value={search} onValueChange={setSearch} />
              <CommandList>
                <CommandEmpty>該当する食材が見つかりません</CommandEmpty>

                {availableIngredients.length > 0 && (
                  <CommandGroup heading="登録済みの食材">
                    {availableIngredients.map((ingredient) => (
                      <CommandItem
                        key={ingredient.id}
                        value={ingredient.name}
                        onSelect={() => handleSelectExisting(ingredient)}
                      >
                        <span className="flex-1">{ingredient.name}</span>
                        <span className="text-muted-foreground text-xs">
                          在庫 {formatQuantity(ingredient.quantity)}
                          {ingredient.unit}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {!catalogLoading &&
                  catalogGroups.map(({ category, items }) => {
                    const expanded = isSearching || openCategories.has(category)
                    return (
                      <div key={category}>
                        {!isSearching && (
                          <button
                            type="button"
                            className="flex items-center gap-2 w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/60"
                            onClick={() => toggleCategory(category)}
                          >
                            <span className="text-base leading-none">
                              {CATEGORY_ICONS[category] ?? '🍽️'}
                            </span>
                            <span className="flex-1 text-left">{category}</span>
                            <span className="text-muted-foreground">{items.length}</span>
                            <ChevronDown
                              className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                        )}
                        {expanded && (
                          <CommandGroup heading={isSearching ? category : undefined}>
                            {items.map((item) => (
                              <CatalogItemRow
                                key={item.id}
                                item={item}
                                category={category}
                                isSearching={isSearching}
                                disabled={catalogSavingId === item.id}
                                onSelect={handleSelectCatalog}
                                onRequestDelete={setDeleteTarget}
                              />
                            ))}
                          </CommandGroup>
                        )}
                      </div>
                    )
                  })}
              </CommandList>
            </Command>

            {error && <p className="text-destructive text-sm px-4 py-2">{error}</p>}

            <button
              type="button"
              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent border-t"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              リストにない食材を追加
            </button>
          </>
        ) : (
          <div className="p-4 flex flex-col gap-4">
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
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                戻る
              </Button>
              <Button type="button" onClick={handleCreate} disabled={saving || !trimmedSearch}>
                {saving ? '追加中...' : '追加して選択'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
      </Dialog>

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
