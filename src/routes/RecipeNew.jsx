import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ClipboardPaste, Download, Lightbulb, Link2, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { useIngredients } from '@/hooks/useIngredients'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useIngredientAliases } from '@/hooks/useIngredientAliases'
import { RecipeItemsEditor } from '@/components/RecipeItemsEditor'
import { RecipeExtrasFields, normalizeExtras } from '@/components/RecipeExtrasFields'
import { RecipeStepsEditor } from '@/components/RecipeStepsEditor'
import { SupportedSites } from '@/components/SupportedSites'
import { keyOf } from '@/components/RecipeItemsEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchRecipeFromUrl } from '@/lib/recipeImport/client'
import { parseRecipeUrl } from '@/lib/recipeImport/sites'
import { importIngredientLines } from '@/lib/recipeImport/match'
import { findDuplicate, saveRecipe } from '@/lib/recipeImport/save'
import { emptyStep } from '@/lib/recipeSteps'

const HOW_IT_WORKS = ['レシピサイトでページの URL をコピー', 'ここに貼って「読み込む」', '材料を確かめて保存']

export function RecipeNew({ groupId, userId }) {
  const { ingredients } = useIngredients(groupId)
  const { catalog } = useIngredientCatalog()
  const { aliases } = useIngredientAliases()
  const [mode, setMode] = useState('url')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [source, setSource] = useState(null) // { sourceKey, site, servings, yieldText }
  const [items, setItems] = useState([])
  const [steps, setSteps] = useState(() => [emptyStep()])
  const [extras, setExtras] = useState({ icon: '', servings: '', instructions: '', memo: '' })
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [importFailed, setImportFailed] = useState(false)
  const [duplicate, setDuplicate] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const supported = useMemo(() => parseRecipeUrl(url), [url])
  const original = mode === 'original'
  const imported = Boolean(source)

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch {
      // 貼り付けの許可がない端末では、欄に長押しで貼り付けてもらう
    }
  }

  async function handleImport() {
    setImportMessage('')
    setImportFailed(false)
    setDuplicate(null)
    setError('')
    if (!supported) {
      setImportFailed(true)
      setImportMessage('このサイトのページからは、材料を自動で読み込めません。URLを残したまま、料理名と材料を下で入れて保存できます')
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
      setImportFailed(true)
      setImportMessage(`${importError}。URLを残したまま、料理名と材料を下で入れて保存できます`)
      return
    }
    setUrl(recipe.url)
    if (!title.trim()) setTitle(recipe.title)
    setSource({ sourceKey: recipe.sourceKey, site: recipe.site, servings: recipe.servings, yieldText: recipe.yieldText })
    if (recipe.servings && !extras.servings) setExtras((prev) => ({ ...prev, servings: String(recipe.servings) }))
    // 見出しの除外 → 複数の食材の分割 → 照合(lib/recipeImport/match の共通の処理)
    const rows = importIngredientLines(recipe.ingredients, { ingredients, catalog, aliases })
      .filter((row) => row.item)
      .map((row) => ({ key: keyOf(), ...row.item }))
    setItems((prev) => [...prev.filter((i) => !i.rawText), ...rows])
    setImportMessage(`${recipe.site} から ${rows.length} 件の材料を読み込みました`)
  }

  function handleUrlChange(value) {
    setUrl(value)
    setImportFailed(false)
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
      // 作り方は、自分で考えたレシピだけ(URL のレシピは元のページで見る)
      steps: original ? steps : undefined,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    // 追加画面を履歴から外して詳細へ(戻ると一覧に戻る)。詳細で「保存しました」と一覧への導線を出す
    navigate(`/recipes/${result.recipeId}`, { replace: true, state: { saved: 'created' } })
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/recipes" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        レシピ一覧
      </Link>
      <h1 className="text-xl font-bold">レシピを追加</h1>

      <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="tablist" aria-label="追加のしかた">
        {[
          { id: 'url', label: 'URLから取り込む', icon: Link2 },
          { id: 'original', label: '自分で考える', icon: Lightbulb },
        ].map(({ id, label, icon: Icon }) => (
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
            わが家のオリジナルレシピを登録できます。手順ごとに使う材料と量も記録できます
          </p>
        ) : (
          <section className="relative flex flex-col gap-3 overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-amber-300 p-4 text-primary-foreground shadow-sm">
            <Sparkles className="pointer-events-none absolute -right-2 -top-2 size-20 rotate-12 opacity-20" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold leading-snug">URLを貼るだけで、わが家のレシピ帳に</h2>
              <p className="mt-0.5 text-xs opacity-80">料理名・材料・分量・人数を読み込みます。作り方は元のページでいつでも見られます</p>
            </div>
            <ol className="grid grid-cols-3 gap-1.5 text-center text-[11px]" aria-label="使いかた">
              {HOW_IT_WORKS.map((text, i) => (
                <li key={text} className="flex flex-col items-center gap-1 rounded-2xl bg-background/70 px-1.5 py-2 text-foreground">
                  <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">{i + 1}</span>
                  {text}
                </li>
              ))}
            </ol>
            <div className="flex flex-col gap-1.5 rounded-2xl bg-background p-2 text-foreground shadow-sm">
              <Label htmlFor="recipe-url" className="px-1 text-xs">
                レシピのURL
              </Label>
              <div className="flex gap-1.5">
                <Input
                  id="recipe-url"
                  type="url"
                  inputMode="url"
                  className="h-11 rounded-xl"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://..."
                />
                <Button type="button" variant="outline" size="icon" className="size-11 shrink-0 rounded-xl" onClick={pasteFromClipboard} aria-label="コピーしたURLを貼り付け">
                  <ClipboardPaste className="size-4" />
                </Button>
              </div>
              <Button type="button" className="h-11 rounded-xl text-base" onClick={handleImport} disabled={importing || !url.trim()}>
                {importing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {importing ? '読み込み中...' : '読み込む'}
              </Button>
              {url.trim() && !importing && (
                <p className="px-1 text-xs text-muted-foreground">
                  {supported ? `${supported.site.name} のレシピとして読み込みます` : 'このURLは自動で読み込めません(URLを残して手動で登録できます)'}
                </p>
              )}
            </div>
            <div className="rounded-2xl bg-background/80 p-3 text-foreground">
              <p className="mb-2 text-xs font-semibold">対応しているレシピサイト</p>
              <SupportedSites activeId={supported?.site.id} />
            </div>
          </section>
        )}

        {!original && (importMessage || duplicate) && (
          <div role="status" className={`rounded-2xl px-3 py-2.5 text-sm ${importFailed ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
            {importMessage}
            {duplicate && (
              <span className="text-destructive">
                このレシピはすでに保存されています:{' '}
                <Link className="underline" to={`/recipes/${duplicate.id}`}>
                  {duplicate.title}
                </Link>
              </span>
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
            placeholder={original ? '例: おばあちゃんの肉じゃが' : '読み込むと自動で入ります'}
          />
          {!original && source?.yieldText && <p className="text-xs text-muted-foreground">分量: {source.yieldText}</p>}
        </div>

        <RecipeItemsEditor
          groupId={groupId}
          ingredients={ingredients}
          items={items}
          setItems={setItems}
          emptyText={original ? 'まだ材料がありません。「材料を選択」から追加してください' : imported ? '材料がありません' : 'URLを読み込むと、ここに材料が並びます。手動で追加することもできます'}
        />

        {original && <RecipeStepsEditor steps={steps} setSteps={setSteps} items={items} />}

        <RecipeExtrasFields value={extras} onChange={(patch) => setExtras((prev) => ({ ...prev, ...patch }))} />

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" className="h-11 text-base" disabled={saving}>
          {saving ? '保存中...' : 'レシピ帳に保存'}
        </Button>
      </form>
    </div>
  )
}
