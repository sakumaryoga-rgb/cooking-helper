import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ExternalLink, Check, ChefHat } from 'lucide-react'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { getRecipeStatus } from '@/lib/matching'
import { formatQuantity } from '@/lib/format'
import { supabase } from '@/supabaseClient'
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

  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const recipe = recipes.find((r) => r.id === id)
  const status = recipe ? getRecipeStatus(recipe, ingredientsById) : null

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

      <ul className="flex flex-col divide-y divide-border rounded-lg border">
        {recipe.recipe_ingredients.map((ri) => {
          const current = ingredientsById.get(ri.ingredient_id)
          const currentQuantity = current?.quantity ?? 0
          const enough = currentQuantity >= ri.required_quantity
          const unit = ri.ingredient?.unit ?? current?.unit ?? ''
          return (
            <li key={ri.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex items-center gap-2">
                {enough ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  <span className="size-2 rounded-full bg-amber-500" />
                )}
                <span className="text-sm">{ri.ingredient?.name ?? current?.name}</span>
              </div>
              <span
                className={`text-xs ${enough ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}
              >
                必要 {formatQuantity(ri.required_quantity)}
                {unit} / 在庫 {formatQuantity(currentQuantity)}
                {unit}
              </span>
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
