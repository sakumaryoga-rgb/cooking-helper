import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '@/supabaseClient'
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

// 冷蔵庫への追加・レシピの材料タグ付けの両方で使う、食材の選択/新規作成コンポーネント。
// 選択(または新規作成)された食材オブジェクトを onSelect(ingredient) で返すだけで、
// 「その用途での数量」はここでは扱わず呼び出し側に任せる。
export function IngredientPicker({ open, onOpenChange, groupId, ingredients, onSelect, excludeIds = [] }) {
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newUnit, setNewUnit] = useState(UNIT_PRESETS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const availableIngredients = useMemo(
    () => ingredients.filter((i) => !excludeIds.includes(i.id)),
    [ingredients, excludeIds]
  )

  const trimmedSearch = search.trim()
  const exactMatch = availableIngredients.some((i) => i.name === trimmedSearch)

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
          <DialogDescription>既存の食材から選ぶか、新しい食材を追加します</DialogDescription>
        </DialogHeader>

        {!creating ? (
          <Command shouldFilter>
            <CommandInput placeholder="食材名で検索..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>該当する食材が見つかりません</CommandEmpty>
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
              {trimmedSearch && !exactMatch && (
                <CommandGroup heading="新規追加">
                  <CommandItem onSelect={() => setCreating(true)}>
                    <Plus className="size-4" />
                    <span>「{trimmedSearch}」を新しい食材として追加</span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
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
