import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ExternalLink, Check, ChefHat } from 'lucide-react'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { describeShortfalls, getRecipeStatus } from '@/lib/matching'
import { formatQuantity } from '@/lib/format'
import { supabase } from '@/supabaseClient'
import { setBusy } from '@/lib/swUpdate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { MakeableBadge } from '@/components/MakeableBadge'

export function RecipeDetail({ groupId }) {
  const { id } = useParams()
  const { ingredients, refresh: refreshIngredients } = useIngredients(groupId)
  const { recipes, loading } = useRecipes(groupId)
  const [cookOpen, setCookOpen] = useState(false)
  const [usedAmounts, setUsedAmounts] = useState({})
  const [saving, setSaving] = useState(false)

  // 調理の確定ダイアログを開いている間は、アプリの更新でリロードされないようにする
  useEffect(() => {
    setBusy('cook-dialog', cookOpen)
    return () => setBusy('cook-dialog', false)
  }, [cookOpen])

  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const recipe = recipes.find((r) => r.id === id)
  const status = recipe ? getRecipeStatus(recipe, ingredientsById) : null

  // 塩・しょうゆなどを常備品にすると、在庫の数量に関係なく「ある」とみなす(家庭ごと)
  async function toggleStaple(ingredient) {
    const { error } = await supabase.from('ingredients').update({ is_staple: !ingredient.is_staple }).eq('id', ingredient.id)
    if (error) console.error('常備品の切り替えに失敗しました', error)
    refreshIngredients()
  }

  function openCookDialog() {
    const defaults = {}
    for (const ri of recipe.recipe_ingredients) {
      defaults[ri.ingredient_id] = ri.required_quantity
    }
    setUsedAmounts(defaults)
    setCookOpen(true)
  }

  async function handleCook() {
    setSaving(true)
    const { error } = await supabase.rpc('cook_recipe', {
      p_recipe_id: recipe.id,
      p_used: usedAmounts,
    })
    setSaving(false)
    if (!error) {
      setCookOpen(false)
      refreshIngredients()
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  if (!recipe) return <p className="text-sm text-muted-foreground">レシピが見つかりません</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-lg font-medium">{recipe.title}</h1>
        <MakeableBadge status={status} />
      </div>

      {recipe.url && (
        <a
          href={recipe.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          レシピを開く
          <ExternalLink className="size-3.5" />
        </a>
      )}

      {status.level !== 'makeable' && status.shortfalls.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">不足: {describeShortfalls(status.shortfalls, 5)}</p>
      )}

      <ul className="flex flex-col divide-y divide-border rounded-lg border">
        {recipe.recipe_ingredients.map((ri) => {
          const current = ingredientsById.get(ri.ingredient_id)
          const staple = Boolean(current?.is_staple)
          const shortfall = status.shortfalls.find((s) => s.ingredientId === ri.ingredient_id)
          const enough = !shortfall
          const unit = ri.ingredient?.unit ?? current?.unit ?? ''
          return (
            <li key={ri.id} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {enough ? (
                    <Check className="size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <span className="size-2 shrink-0 rounded-full bg-amber-500" />
                  )}
                  <span className="text-sm truncate">{ri.ingredient?.name ?? current?.name}</span>
                </div>
                <span className={`text-xs text-right ${enough ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}>
                  {staple ? (
                    '常備品'
                  ) : (
                    <>
                      必要 {formatQuantity(ri.required_quantity)}
                      {unit} / 在庫 {formatQuantity(current?.quantity ?? 0)}
                      {unit}
                      {shortfall && (
                        <span className="font-medium">
                          {' '}
                          ・あと{formatQuantity(shortfall.missingQuantity)}
                          {unit}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </div>
              {current && (
                <button
                  type="button"
                  className="self-end text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => toggleStaple(current)}
                >
                  {staple ? '常備品から外す' : '常備品にする(在庫を数えない)'}
                </button>
              )}
              {ri.raw_text && <p className="text-xs text-muted-foreground">元の表記: {ri.raw_text}</p>}
            </li>
          )
        })}
      </ul>

      <Button onClick={openCookDialog}>
        <ChefHat className="size-4" />
        これを作る
      </Button>

      <Dialog open={cookOpen} onOpenChange={setCookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>使用した材料を確認</DialogTitle>
            <DialogDescription>実際に使った分量に調整できます</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {recipe.recipe_ingredients.map((ri) => (
              <div key={ri.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{ri.ingredient?.name}</span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  className="w-20 h-8"
                  value={usedAmounts[ri.ingredient_id] ?? ri.required_quantity}
                  onChange={(e) =>
                    setUsedAmounts((prev) => ({ ...prev, [ri.ingredient_id]: e.target.value }))
                  }
                />
                <span className="text-xs text-muted-foreground w-8">{ri.ingredient?.unit}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCookOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleCook} disabled={saving}>
              {saving ? '確定中...' : '確定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
