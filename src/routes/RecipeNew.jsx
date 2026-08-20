import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { useIngredients } from '@/hooks/useIngredients'
import { IngredientPicker } from '@/components/IngredientPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RecipeNew({ groupId, userId }) {
  const { ingredients } = useIngredients(groupId)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [tagged, setTagged] = useState([]) // [{ ingredient, requiredQuantity }]
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function handlePicked(ingredient) {
    setTagged((prev) => [...prev, { ingredient, requiredQuantity: 1 }])
  }

  function updateQuantity(ingredientId, value) {
    setTagged((prev) =>
      prev.map((t) => (t.ingredient.id === ingredientId ? { ...t, requiredQuantity: value } : t))
    )
  }

  function removeTagged(ingredientId) {
    setTagged((prev) => prev.filter((t) => t.ingredient.id !== ingredientId))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const validEntries = tagged.filter((t) => Number(t.requiredQuantity) > 0)
    if (!title.trim()) {
      setError('タイトルを入力してください')
      return
    }
    if (validEntries.length === 0) {
      setError('材料を1つ以上、必要な分量を入力して追加してください')
      return
    }

    setSaving(true)
    const { data: recipe, error: recipeError } = await supabase
      .from('recipes')
      .insert({ group_id: groupId, title: title.trim(), url: url.trim() || null, created_by: userId })
      .select()
      .single()

    if (recipeError) {
      setSaving(false)
      setError('レシピの保存に失敗しました')
      return
    }

    const rows = validEntries.map((t) => ({
      recipe_id: recipe.id,
      ingredient_id: t.ingredient.id,
      required_quantity: Number(t.requiredQuantity),
    }))

    const { error: riError } = await supabase.from('recipe_ingredients').insert(rows)
    setSaving(false)

    if (riError) {
      setError('材料の保存に失敗しました')
      return
    }

    navigate(`/recipes/${recipe.id}`, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">レシピを追加</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-title">タイトル</Label>
          <Input id="recipe-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-url">レシピのURL(任意)</Label>
          <Input
            id="recipe-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://cookpad.com/..."
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>材料</Label>
            <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              <Plus className="size-4" />
              材料を選択
            </Button>
          </div>

          {tagged.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだ材料が選択されていません</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border">
              {tagged.map(({ ingredient, requiredQuantity }) => (
                <li key={ingredient.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex-1 text-sm truncate">{ingredient.name}</span>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="w-20 h-8"
                    value={requiredQuantity}
                    onChange={(e) => updateQuantity(ingredient.id, e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground w-8">{ingredient.unit}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => removeTagged(ingredient.id)}
                    aria-label="削除"
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" disabled={saving}>
          {saving ? '保存中...' : 'レシピを保存'}
        </Button>
      </form>

      <IngredientPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        groupId={groupId}
        ingredients={ingredients}
        onSelect={handlePicked}
        excludeIds={tagged.map((t) => t.ingredient.id)}
      />
    </div>
  )
}
