import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download, Loader2, Plus, X } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { useIngredients } from '@/hooks/useIngredients'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useIngredientAliases } from '@/hooks/useIngredientAliases'
import { IngredientPicker } from '@/components/IngredientPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchRecipeFromUrl } from '@/lib/recipeImport/client'
import { parseRecipeUrl, SUPPORTED_SITES } from '@/lib/recipeImport/sites'
import { isHeadingLine, parseIngredientLine } from '@/lib/recipeImport/ingredientLine'
import { resolveIngredient } from '@/lib/recipeImport/match'
import { findDuplicate, saveRecipe } from '@/lib/recipeImport/save'

let nextKey = 0
const keyOf = () => `item-${nextKey++}`

export function RecipeNew({ groupId, userId }) {
  const { ingredients } = useIngredients(groupId)
  const { catalog } = useIngredientCatalog()
  const { aliases } = useIngredientAliases()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [source, setSource] = useState(null) // { sourceKey, site, servings, yieldText }
  const [items, setItems] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [duplicate, setDuplicate] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const supported = useMemo(() => parseRecipeUrl(url), [url])

  async function handleImport() {
    setImportMessage('')
    setDuplicate(null)
    setError('')
    if (!supported) {
      setImportMessage(
        `材料を読み込めるのは ${SUPPORTED_SITES.map((s) => s.name).join('、')} のレシピです。ほかのサイトは、URLを残して材料を手動で追加してください`
      )
      return
    }
    const dup = await findDuplicate(supabase, groupId, supported.sourceKey)
    if (dup) {
      setDuplicate(dup)
      return
    }
    setImporting(true)
    const { recipe, error: importError } = await fetchRecipeFromUrl(supported.url)
    setImporting(false)
    if (importError) {
      setImportMessage(importError)
      return
    }
    setUrl(recipe.url)
    if (!title.trim()) setTitle(recipe.title)
    setSource({ sourceKey: recipe.sourceKey, site: recipe.site, servings: recipe.servings, yieldText: recipe.yieldText })
    const imported = recipe.ingredients
      .filter((line) => !isHeadingLine(line))
      .map((line) => {
        const parsed = parseIngredientLine(line)
        return { key: keyOf(), rawText: line, ...resolveIngredient(parsed, ingredients, catalog, aliases) }
      })
    setItems((prev) => [...prev.filter((i) => !i.rawText), ...imported])
    setImportMessage(`${recipe.site} から ${imported.length} 件の材料を読み込みました。分量と保存する材料を確かめてください`)
  }

  function handlePicked(ingredient) {
    setItems((prev) => [
      ...prev,
      { key: keyOf(), kind: 'existing', ingredient, name: ingredient.name, unit: ingredient.unit, requiredQuantity: 1, include: true, needsCheck: false },
    ])
  }

  function updateItem(key, patch) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  }

  function removeItem(key) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  function handleUrlChange(value) {
    setUrl(value)
    // 別のレシピの URL に変えたら、取り込み元の情報は外す
    if (source && parseRecipeUrl(value)?.sourceKey !== source.sourceKey) setSource(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const result = await saveRecipe({
      supabase,
      groupId,
      userId,
      title,
      url,
      sourceKey: source?.sourceKey,
      sourceSite: source?.site,
      servings: source?.servings,
      items,
      fridge: ingredients,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    navigate(`/recipes/${result.recipeId}`, { replace: true })
  }

  const usedIngredientIds = items.filter((i) => i.kind === 'existing').map((i) => i.ingredient.id)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">レシピを追加</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-url">レシピのURL</Label>
          <div className="flex gap-2">
            <Input
              id="recipe-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://www.kurashiru.com/recipes/..."
            />
            <Button type="button" variant="outline" onClick={handleImport} disabled={importing || !url.trim()}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              読み込む
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {SUPPORTED_SITES.map((s) => s.name).join('、')} のURLなら、料理名と材料を読み込めます(作り方は元のページで見られます)
          </p>
          {importMessage && <p className="text-sm text-muted-foreground">{importMessage}</p>}
          {duplicate && (
            <p className="text-sm text-destructive">
              このレシピはすでに保存されています:{' '}
              <Link className="underline" to={`/recipes/${duplicate.id}`}>
                {duplicate.title}
              </Link>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-title">タイトル</Label>
          <Input id="recipe-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          {source?.yieldText && <p className="text-xs text-muted-foreground">分量: {source.yieldText}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>材料</Label>
            <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              <Plus className="size-4" />
              材料を選択
            </Button>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだ材料がありません。URLから読み込むか、材料を選択してください</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border">
              {items.map((item) => (
                <li key={item.key} className={`flex flex-col gap-1 px-3 py-2 ${item.include ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      checked={item.include}
                      onChange={(e) => updateItem(item.key, { include: e.target.checked })}
                      aria-label={`${item.name}を保存する`}
                    />
                    <span className="flex-1 text-sm truncate">
                      {item.name}
                      {item.kind === 'new' && <span className="ml-1 text-xs text-muted-foreground">(新しい食材)</span>}
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      className="w-20 h-8"
                      value={item.requiredQuantity}
                      onChange={(e) => updateItem(item.key, { requiredQuantity: e.target.value, needsCheck: false })}
                      aria-label={`${item.name}の分量`}
                    />
                    <span className="text-xs text-muted-foreground w-10">{item.unit}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => removeItem(item.key)}
                      aria-label={`${item.name}を削除`}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                  {(item.rawText || item.needsCheck) && (
                    <p className="pl-6 text-xs text-muted-foreground">
                      {item.rawText}
                      {item.needsCheck && item.include && <span className="ml-1 text-destructive">分量を確かめてください</span>}
                    </p>
                  )}
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
        excludeIds={usedIngredientIds}
      />
    </div>
  )
}
