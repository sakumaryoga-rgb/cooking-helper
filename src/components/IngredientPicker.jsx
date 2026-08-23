import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
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

const UNIT_PRESETS = ['個', 'g', 'ml', '本', 'パック', '袋', '枚']

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
  const [saving, setSaving] = useState(false)
  const [catalogSavingId, setCatalogSavingId] = useState(null)
  const [error, setError] = useState(null)

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

  function reset() {
    setSearch('')
    setCreating(false)
    setNewUnit(UNIT_PRESETS[0])
    setError(null)
  }

  function handleOpenChange(next) {
    if (!next) reset()
    onOpenChange(next)
  }

  function handleSelectExisting(ingredient) {
    onSelect(ingredient)
    handleOpenChange(false)
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
    const { data, error: insertError } = await supabase
      .from('ingredients')
      .insert({ group_id: groupId, name: trimmedSearch, unit: newUnit, quantity: 0 })
      .select()
      .single()
    setSaving(false)
    if (insertError) {
      setError('追加に失敗しました。同じ名前の食材が既にあるかもしれません。')
      return
    }
    onSelect(data)
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>食材を選択</DialogTitle>
          <DialogDescription>食材を選ぶと単位は自動で設定されます</DialogDescription>
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
                  catalogGroups.map(({ category, items }) => (
                    <CommandGroup key={category} heading={category}>
                      {items.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={item.name}
                          disabled={catalogSavingId === item.id}
                          onSelect={() => handleSelectCatalog(item)}
                        >
                          <span className="flex-1">{item.name}</span>
                          <span className="text-muted-foreground text-xs">{item.unit}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
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
  )
}
