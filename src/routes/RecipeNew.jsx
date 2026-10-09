import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download, Lightbulb, Link2, Loader2 } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { useIngredients } from '@/hooks/useIngredients'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useIngredientAliases } from '@/hooks/useIngredientAliases'
import { RecipeItemsEditor, keyOf } from '@/components/RecipeItemsEditor'
import { RecipeExtrasFields, normalizeExtras } from '@/components/RecipeExtrasFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchRecipeFromUrl } from '@/lib/recipeImport/client'
import { parseRecipeUrl, SUPPORTED_SITES } from '@/lib/recipeImport/sites'
import { importIngredientLines } from '@/lib/recipeImport/match'
import { findDuplicate, saveRecipe } from '@/lib/recipeImport/save'

const MODES = [
  { id: 'url', label: 'URLから取り込む', icon: Link2 },
  { id: 'original', label: '自分で考える', icon: Lightbulb },
]

export function RecipeNew({ groupId, userId }) {
  const { ingredients } = useIngredients(groupId)
  const { catalog } = useIngredientCatalog()
  const { aliases } = useIngredientAliases()
  const [mode, setMode] = useState('url')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [source, setSource] = useState(null) // { sourceKey, site, servings, yieldText }
  const [items, setItems] = useState([])
  const [extras, setExtras] = useState({ icon: '', servings: '', instructions: '', memo: '' })
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [duplicate, setDuplicate] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const supported = useMemo(() => parseRecipeUrl(url), [url])
  const original = mode === 'original'

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
    if (recipe.servings && !extras.servings) setExtras((prev) => ({ ...prev, servings: String(recipe.servings) }))
    // 見出しの除外 → 複数の食材の分割 → 照合(lib/recipeImport/match の共通の処理)
    const imported = importIngredientLines(recipe.ingredients, { ingredients, catalog, aliases })
      .filter((row) => row.item)
      .map((row) => ({ key: keyOf(), ...row.item }))
    setItems((prev) => [...prev.filter((i) => !i.rawText), ...imported])
    setImportMessage(`${recipe.site} から ${imported.length} 件の材料を読み込みました。分量と保存する材料を確かめてください`)
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
      // 自分で考えたレシピは URL・取り込み元を持たない
      url: original ? null : url,
      sourceKey: original ? null : source?.sourceKey,
      sourceSite: original ? null : source?.site,
      servings: original ? null : source?.servings,
      items,
      fridge: ingredients,
      extras: normalizeExtras(extras),
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    navigate(`/recipes/${result.recipeId}`, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">レシピを追加</h1>

      <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="tablist" aria-label="追加のしかた">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors ${
              mode === id ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {original ? (
          <p className="rounded-2xl bg-primary/15 px-3 py-2.5 text-sm">
            わが家のオリジナルレシピを登録できます。材料を選ぶと、冷蔵庫の在庫で作れるかどうかも分かります
          </p>
        ) : (
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
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-title">{original ? '料理名' : 'タイトル'}</Label>
          <Input
            id="recipe-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            placeholder={original ? '例: おばあちゃんの肉じゃが' : undefined}
          />
          {!original && source?.yieldText && <p className="text-xs text-muted-foreground">分量: {source.yieldText}</p>}
        </div>

        <RecipeItemsEditor
          groupId={groupId}
          ingredients={ingredients}
          items={items}
          setItems={setItems}
          emptyText={original ? 'まだ材料がありません。「材料を選択」から追加してください' : 'まだ材料がありません。URLから読み込むか、材料を選択してください'}
        />

        <RecipeExtrasFields value={extras} onChange={(patch) => setExtras((prev) => ({ ...prev, ...patch }))} />

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" disabled={saving}>
          {saving ? '保存中...' : 'レシピを保存'}
        </Button>
      </form>
    </div>
  )
}
