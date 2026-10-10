import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, CheckCircle2, ExternalLink, Check, ChefHat, Minus, Pencil, Plus, X } from 'lucide-react'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useSubstitutions } from '@/hooks/useSubstitutions'
import { useCookLogs } from '@/hooks/useCookLogs'
import { useIngredientAliases } from '@/hooks/useIngredientAliases'
import { useUnitConversions } from '@/hooks/useUnitConversions'
import { buildNameIndex, matchIngredientName } from '@/lib/ingredientName'
import { parseAmount } from '@/lib/recipeImport/ingredientLine'
import { quantityInUnit } from '@/lib/recipeImport/match'
import { ensureIngredient, learnAliases } from '@/lib/recipeImport/save'
import { buildCookPlan, describeNotSubtracted, describeShortfalls, getRecipeStatus, scaleRecipe } from '@/lib/matching'
import { formatQuantity } from '@/lib/format'
import { supabase } from '@/supabaseClient'
import { setBusy } from '@/lib/swUpdate'
import { Button, buttonVariants } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MakeableBadge } from '@/components/MakeableBadge'
import { dishLook } from '@/lib/foodLook'
import { savedUsageMismatches } from '@/lib/recipeSteps'
import { QuantityInput } from '@/components/QuantityInput'
import { snapToStock } from '@/lib/quantity'

// 確定のあとに「取り消す」を出しておく時間
const UNDO_TOAST_MS = 8000

export function RecipeDetail({ groupId }) {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  // 追加・取り込みの直後(RecipeNew から)は「保存しました」と一覧への導線を出す
  const [savedNotice, setSavedNotice] = useState(() => location.state?.saved === 'created')
  const { ingredients, refresh: refreshIngredients } = useIngredients(groupId)
  const { recipes, loading, refresh: refreshRecipes } = useRecipes(groupId)
  const { aliases } = useIngredientAliases()
  const { conversions, remember } = useUnitConversions(groupId)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolveError, setResolveError] = useState('')
  const { catalog } = useIngredientCatalog()
  const { rules: substitutions, disableRule } = useSubstitutions(groupId)
  const { logs, refresh: refreshLogs } = useCookLogs(id)
  const [servings, setServings] = useState(null) // 作る人数(null は元の人数)
  const [choices, setChoices] = useState(() => new Map()) // 材料ごとに選んだ代替
  const [cookOpen, setCookOpen] = useState(false)
  const [plan, setPlan] = useState([])
  const [requestId, setRequestId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [cookError, setCookError] = useState('')
  const [undoingId, setUndoingId] = useState(null)
  const [justCooked, setJustCooked] = useState(null) // 確定直後の記録 ID(数秒だけ「取り消す」を出す)
  const toastTimer = useRef(null)

  // 調理の確定シートを開いている間は、アプリの更新でリロードされないようにする
  useEffect(() => {
    setBusy('cook-dialog', cookOpen)
    return () => setBusy('cook-dialog', false)
  }, [cookOpen])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const recipe = recipes.find((r) => r.id === id)
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])
  const baseServings = recipe?.servings ?? null
  const factor = baseServings && servings ? servings / baseServings : 1
  const scaled = useMemo(() => scaleRecipe(recipe, factor), [recipe, factor])
  const status = scaled ? getRecipeStatus(scaled, ingredientsById, { substitutions, catalogById, choices, conversions }) : null
  const nameIndex = useMemo(() => buildNameIndex({ ingredients, catalog, aliases }), [ingredients, catalog, aliases])

  // 確認待ちの材料(どの食材か未確定)を1タップで決める。候補・新しい食材を選んだら行を更新し、表記を家の別名として覚える
  async function resolvePending(ri, option) {
    setResolvingId(ri.id)
    setResolveError('')
    try {
      const target =
        option.kind === 'existing'
          ? option.ingredient
          : { id: await ensureIngredient(supabase, groupId, option.kind === 'catalog' ? option : { kind: 'new', name: ri.source_name, unit: parseAmount(ri.amount_text ?? '').unit || '個' }, ingredients), unit: option.unit }
      const parsed = parseAmount(ri.amount_text ?? '')
      const qty = ri.required_quantity ?? quantityInUnit(parsed, target.unit ?? option.unit)
      const duplicate = (recipe.recipe_ingredients ?? []).some((x) => x.ingredient_id === target.id)
      const { error } = duplicate
        ? // すでに同じ食材の材料がある: 確認待ちの行をまとめて消す
          await supabase.from('recipe_ingredients').delete().eq('id', ri.id)
        : await supabase
            .from('recipe_ingredients')
            .update({ ingredient_id: target.id, source_name: null, required_quantity: qty ?? null })
            .eq('id', ri.id)
      if (error) throw error
      const catalogId = option.kind === 'existing' ? option.ingredient.catalog_id : option.kind === 'catalog' ? option.catalogItem.id : null
      if (catalogId) await learnAliases(supabase, groupId, [{ include: true, name: option.name, learnAlias: { alias: ri.source_name, catalogId } }])
      await refreshIngredients()
      await refreshRecipes?.()
    } catch {
      setResolveError('材料を更新できませんでした。選んでいる家のレシピか確かめてください')
    } finally {
      setResolvingId(null)
    }
  }

  // 塩・しょうゆなどを常備品にすると、在庫の数量に関係なく「ある」とみなす(家庭ごと)
  async function toggleStaple(ingredient) {
    const { error } = await supabase.from('ingredients').update({ is_staple: !ingredient.is_staple }).eq('id', ingredient.id)
    if (error) console.error('常備品の切り替えに失敗しました', error)
    refreshIngredients()
  }

  function chooseSubstitute(ingredientId, value) {
    setChoices((prev) => new Map(prev).set(ingredientId, value))
  }

  function openCookSheet() {
    setPlan(buildCookPlan(status))
    // 確定ボタンの連打や再送でも1回分だけ差し引くための ID(シートを開くたびに作り直す)
    setRequestId(crypto.randomUUID())
    setCookError('')
    setCookOpen(true)
  }

  function updatePlan(key, patch) {
    setPlan((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  async function handleCook() {
    if (saving) return
    setSaving(true)
    setCookError('')
    // 量が入っている行だけを在庫から引く(数が分からない分量は、入れたときだけ)
    const items = plan
      .filter((row) => row.include && Number(row.quantity) > 0)
      // 1/3 を3回使ったときなどに在庫へ 0.000001 のような端数を残さない
      .map((row) => ({ ingredient_id: row.ingredientId, quantity: snapToStock(row.quantity, ingredientsById.get(row.ingredientId)?.quantity), substitute_for: row.substituteFor }))
    const toRemember = plan.filter((row) => row.unknown && row.remember && row.include && Number(row.quantity) > 0)
    const { data: logId, error } = await supabase.rpc('cook_recipe_v2', { p_recipe_id: recipe.id, p_items: items, p_request_id: requestId })
    setSaving(false)
    if (error) {
      setCookError('在庫を更新できませんでした。もう一度お試しください')
      return
    }
    setCookOpen(false)
    // 「1パック = 200g として覚える」を選んだ材料の換算を、この家で覚える
    for (const row of toRemember) {
      const a = parseAmount(row.amountText ?? '')
      const base = Number(a.quantity) * (factor || 1)
      if (a.unit && base > 0) await remember(row.ingredientId, a.unit, Math.round((Number(row.quantity) / base) * 100) / 100)
    }
    refreshIngredients()
    refreshLogs()
    if (logId) {
      setJustCooked(logId)
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setJustCooked(null), UNDO_TOAST_MS)
    }
  }

  async function handleUndo(logId) {
    setUndoingId(logId)
    const { error } = await supabase.rpc('undo_cook', { p_cook_log_id: logId })
    setUndoingId(null)
    if (error) console.error('取り消しに失敗しました', error)
    if (logId === justCooked) setJustCooked(null)
    refreshIngredients()
    refreshLogs()
  }

  if (loading) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  if (!recipe)
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">レシピが見つかりません(削除されたか、ほかの家のレシピです)</p>
        <Link to="/recipes" replace className="text-sm underline underline-offset-2">
          レシピ一覧へ
        </Link>
      </div>
    )

  const shownServings = servings ?? baseServings
  const stepMismatches = savedUsageMismatches(recipe.steps, recipe.recipe_ingredients ?? [])
  const nameOfUse = (u) => (u.ingredient_id ? ingredientsById.get(u.ingredient_id)?.name ?? (recipe.recipe_ingredients ?? []).find((r) => r.ingredient_id === u.ingredient_id)?.ingredient?.name : u.source_name) ?? '(材料)'
  const unitOfUse = (u) => (u.ingredient_id ? ingredientsById.get(u.ingredient_id)?.unit ?? '' : '')

  return (
    <div className="flex flex-col gap-4 pb-16">
      <Link to="/recipes" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        レシピ一覧
      </Link>

      {savedNotice && (
        <div role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="flex-1">レシピ帳に保存しました</span>
          <Button size="sm" variant="outline" className="h-7 rounded-full bg-background" onClick={() => navigate('/recipes')}>
            レシピ一覧へ
          </Button>
          <button type="button" aria-label="閉じる" className="rounded-full p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900" onClick={() => setSavedNotice(false)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-start gap-3">
        <span className={`flex size-16 shrink-0 items-center justify-center rounded-2xl text-4xl ${dishLook(recipe).bg}`} aria-hidden="true">
          {dishLook(recipe).emoji}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-xl font-bold leading-snug">{recipe.title}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <MakeableBadge status={status} />
            {!recipe.url && (
              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                わが家のオリジナル
              </span>
            )}
          </div>
          {recipe.source_site && <span className="text-xs text-muted-foreground">出典: {recipe.source_site}</span>}
        </div>
        <Link
          to={`/recipes/${recipe.id}/edit`}
          state={{ from: 'detail' }}
          className="flex shrink-0 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent/50"
        >
          <Pencil className="size-3.5" />
          編集・削除
        </Link>
      </div>

      {baseServings && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">人数</span>
          <Button size="icon" variant="outline" className="size-7" aria-label="人数を減らす" disabled={shownServings <= 1} onClick={() => setServings(Math.max(1, shownServings - 1))}>
            <Minus className="size-3.5" />
          </Button>
          <span className="w-12 text-center font-medium">{shownServings}人分</span>
          <Button size="icon" variant="outline" className="size-7" aria-label="人数を増やす" disabled={shownServings >= 20} onClick={() => setServings(Math.min(20, shownServings + 1))}>
            <Plus className="size-3.5" />
          </Button>
          {factor !== 1 && <span className="text-xs text-muted-foreground">(元は{baseServings}人分)</span>}
        </div>
      )}

      {(status.level === 'almost' || status.level === 'short') && (
        <p className="text-sm text-destructive">不足: {describeShortfalls(status.shortfalls, 5)}</p>
      )}
      {status.level === 'check' && (
        <p className="text-sm text-violet-800 dark:text-violet-300">
          {status.pendingCount > 0 && `どの食材か決まっていない材料が${status.pendingCount}品あります。`}
          {status.uncertainCount > 0 && `分量を数で比べられない材料が${status.uncertainCount}品あります(在庫はあります)。`}
        </p>
      )}
      {resolveError && <p className="text-sm text-destructive">{resolveError}</p>}

      <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card">
        {scaled.recipe_ingredients.map((ri) => {
          if (!ri.ingredient_id) {
            // 確認待ち(どの食材か未確定): 候補を1タップで選ぶ
            const match = matchIngredientName(ri.source_name, nameIndex, { notes: ri.note ? ri.note.split('・') : [] })
            const options = match.status === 'auto' ? [match.option] : match.candidates
            return (
              <li key={ri.id} className="flex flex-col gap-1.5 bg-violet-50/60 px-3 py-2.5 dark:bg-violet-950/30">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    <span className="mr-1 rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-300">確認待ち</span>
                    {ri.source_name}
                  </span>
                  <span className="text-xs text-muted-foreground">{ri.amount_text}</span>
                </div>
                <p className="text-xs text-muted-foreground">どの食材ですか?(選ぶと次から自動で決まります)</p>
                <div className="flex flex-wrap gap-1.5">
                  {options.map((option) => (
                    <Button
                      key={option.kind + (option.ingredient?.id ?? option.catalogItem?.id)}
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-full text-xs"
                      disabled={resolvingId === ri.id}
                      onClick={() => resolvePending(ri, option)}
                    >
                      {option.name}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" className="h-7 rounded-full text-xs" disabled={resolvingId === ri.id} onClick={() => resolvePending(ri, { kind: 'new', name: ri.source_name })}>
                    新しい食材「{ri.source_name}」
                  </Button>
                </div>
              </li>
            )
          }
          const current = ingredientsById.get(ri.ingredient_id)
          const staple = Boolean(current?.is_staple)
          const line = status.lines.find((l) => l.ingredientId === ri.ingredient_id)
          const shortfall = status.shortfalls.find((s) => s.ingredientId === ri.ingredient_id)
          const enough = !shortfall
          const unit = ri.ingredient?.unit ?? current?.unit ?? ''
          const chosen = choices.get(ri.ingredient_id) ?? line?.substitutes[0]?.ruleId ?? ''
          return (
            <li key={ri.id} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {enough ? <Check className="size-4 shrink-0 text-emerald-600" /> : <span className="size-2 shrink-0 rounded-full bg-destructive" />}
                  <span className="text-sm truncate">{ri.ingredient?.name ?? current?.name}</span>
                </div>
                <span className={`text-xs text-right ${enough ? 'text-muted-foreground' : 'text-destructive'}`}>
                  {staple ? (
                    '常備品'
                  ) : line?.amountUnknown || line?.vague ? (
                    // 数で分からない分量(1パック・少々): 元の表記のまま。在庫と比べられない
                    <>
                      {ri.amount_text || '分量不明'}
                      {line.amountUnknown && <span className="ml-1 text-violet-700 dark:text-violet-400">・分量を確認</span>}
                      {' '}/ 在庫 {formatQuantity(current?.quantity ?? 0)}
                      {unit}
                    </>
                  ) : (
                    <>
                      {line?.converted && <span className="text-violet-700 dark:text-violet-400">{ri.amount_text}≈</span>}
                      必要 {formatQuantity(line?.converted ? line.requiredQuantity : ri.required_quantity)}
                      {unit} / 在庫 {formatQuantity(current?.quantity ?? 0)}
                      {unit}
                      {shortfall && (
                        <span className="font-medium">
                          {' '}
                          ・不足 {formatQuantity(shortfall.missingQuantity)}
                          {unit}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </div>
              {line?.candidates.length > 0 && (
                <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
                  <label htmlFor={`sub-${ri.id}`} className="shrink-0">
                    代わりに
                  </label>
                  <select
                    id={`sub-${ri.id}`}
                    className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5"
                    value={line.substitutes.length > 0 ? chosen : 'none'}
                    onChange={(e) => chooseSubstitute(ri.ingredient_id, e.target.value)}
                    aria-label={`${ri.ingredient?.name ?? current?.name}の代替`}
                  >
                    <option value="none">使わない</option>
                    {line.candidates.map((c) => (
                      <option key={c.ruleId} value={c.ruleId} disabled={!c.enough}>
                        {c.name} {formatQuantity(c.quantity)}
                        {c.unit}
                        {c.enough ? '' : '(在庫不足)'}
                        {c.note ? `・${c.note}` : ''}
                      </option>
                    ))}
                  </select>
                  {line.substitutes[0] && (
                    <button type="button" className="shrink-0 text-muted-foreground underline-offset-2 hover:underline" onClick={() => disableRule(line.substitutes[0].ruleId)}>
                      今後使わない
                    </button>
                  )}
                </div>
              )}
              {current && (
                <button type="button" className="self-end text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => toggleStaple(current)}>
                  {staple ? '常備品から外す' : '常備品にする(在庫を数えない)'}
                </button>
              )}
              {ri.note && <p className="text-xs text-muted-foreground">状態: {ri.note}</p>}
              {ri.raw_text && <p className="text-xs text-muted-foreground">元の表記: {ri.raw_text}</p>}
            </li>
          )
        })}
      </ul>

      {recipe.url && (
        // URL から取り込んだレシピ: 作り方は元のページで見る
        <a
          href={recipe.url}
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-3 rounded-2xl border-2 border-primary/60 bg-primary/10 px-4 py-3 shadow-sm transition-colors hover:bg-primary/20"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <BookOpen className="size-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-semibold">元のレシピで作り方を見る</span>
            <span className="truncate text-xs text-muted-foreground">{recipe.source_site ? `${recipe.source_site} のページを開きます` : recipe.url}</span>
          </span>
          <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </a>
      )}

      {Array.isArray(recipe.steps) && recipe.steps.length > 0 ? (
        // 手順ごとの材料と量(オリジナルレシピ)
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">作り方</h2>
          <ol className="flex flex-col gap-2">
            {recipe.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5 rounded-2xl border bg-card px-3 py-2.5 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {step.text && <span className="whitespace-pre-wrap">{step.text}</span>}
                  {(step.uses ?? []).length > 0 && (
                    <ul className="flex flex-wrap gap-1.5" aria-label={`手順${i + 1}で使う材料`}>
                      {step.uses.map((u, k) => (
                        <li key={k} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                          {nameOfUse(u)}
                          {u.quantity ? ` ${formatQuantity(u.quantity)}${unitOfUse(u)}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {stepMismatches.length > 0 && (
            <p className="text-xs text-muted-foreground">
              手順の量の合計が材料の分量と違う材料があります(
              {stepMismatches.map((m) => `${nameOfUse({ ingredient_id: m.ingredientId })} 手順${m.stepsTotal}/材料${m.recipeQuantity}${unitOfUse({ ingredient_id: m.ingredientId })}`).join('、')}
              )。在庫は材料の分量で引きます
            </p>
          )}
        </section>
      ) : (
        recipe.instructions && (
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">作り方{recipe.url ? '(メモ)' : ''}</h2>
            <ol className="flex flex-col gap-2">
              {recipe.instructions
                .split('\n')
                .map((step) => step.trim())
                .filter(Boolean)
                .map((step, i) => (
                  <li key={i} className="flex gap-2.5 rounded-2xl border bg-card px-3 py-2.5 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                    <span className="whitespace-pre-wrap">{step.replace(/^\d+[.)、.]\s*/, '')}</span>
                  </li>
                ))}
            </ol>
          </section>
        )
      )}

      {recipe.memo && (
        <section className="rounded-2xl bg-amber-50 px-3 py-2.5 text-sm dark:bg-amber-950/40">
          <h2 className="mb-1 text-xs font-semibold text-amber-800 dark:text-amber-300">わが家のメモ</h2>
          <p className="whitespace-pre-wrap">{recipe.memo}</p>
        </section>
      )}

      {logs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">24時間以内に作った記録</h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm">{new Date(log.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {(log.cook_log_items ?? [])
                      .filter((i) => Number(i.used_quantity) > 0)
                      .map((i) => `${i.ingredient_name} ${formatQuantity(i.used_quantity)}${i.unit}`)
                      .join('、') || '在庫の変更なし'}
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleUndo(log.id)} disabled={undoingId === log.id}>
                  取り消す
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 主要なボタンは画面下部(下部タブの上)に固定する */}
      <div className="fixed inset-x-0 bottom-nav z-10 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2 px-4 py-2">
          {recipe.url && (
            <a href={recipe.url} target="_blank" rel="noreferrer" className={`${buttonVariants({ variant: 'outline' })} flex-1`}>
              元のレシピを見る
              <ExternalLink className="size-3.5" />
            </a>
          )}
          <Button className="flex-1" onClick={openCookSheet}>
            <ChefHat className="size-4" />
            これを作る
          </Button>
        </div>
      </div>

      {justCooked && (
        <div role="status" className="fixed inset-x-0 bottom-[calc(7.5rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
            在庫を更新しました
            <button type="button" className="font-medium text-primary" onClick={() => handleUndo(justCooked)}>
              取り消す
            </button>
          </div>
        </div>
      )}

      <Sheet open={cookOpen} onOpenChange={setCookOpen}>
        <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto pb-safe">
          <SheetHeader>
            <SheetTitle>使った材料を確認</SheetTitle>
            <SheetDescription>使った量と代替を確かめて確定します。使わない材料はチェックを外します</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4">
            {(() => {
              const skipped = describeNotSubtracted(status, plan)
              if (skipped.pending.length + skipped.unknown.length === 0) return null
              return (
                <p role="note" className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
                  次の材料は在庫から引きません
                  {skipped.unknown.length > 0 && `(分量が決まっていない: ${skipped.unknown.join('、')}。使った量を入れると引きます)`}
                  {skipped.pending.length > 0 && `(どの食材か決まっていない: ${skipped.pending.join('、')}。レシピの画面で選ぶと引けるようになります)`}
                </p>
              )
            })()}
            {plan.map((row) => (
              <div key={row.key} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={row.include}
                    onChange={(e) => updatePlan(row.key, { include: e.target.checked })}
                    aria-label={`${row.name}を使う`}
                  />
                  <span className="flex-1 text-sm">{row.name}</span>
                  <QuantityInput
                    className="w-20 h-8"
                    value={row.quantity}
                    onChange={(v) => updatePlan(row.key, row.unknown ? { quantity: v, include: Number(v) > 0 } : { quantity: v })}
                    aria-label={`${row.name}の使用量`}
                  />
                  <span className="text-xs text-muted-foreground w-8">{row.unit}</span>
                </div>
                {row.substituteFor && <p className="pl-6 text-xs text-amber-700 dark:text-amber-400">{row.substituteFor}の代わり</p>}
                {row.staple && <p className="pl-6 text-xs text-violet-700 dark:text-violet-400">常備品なので在庫から引きません(引くときはチェック)</p>}
                {row.converted && (
                  <p className="pl-6 text-xs text-violet-700 dark:text-violet-400">
                    レシピの「{row.amountText}」を、覚えた「1{row.converted.unit} = {row.converted.per}
                    {row.unit}」で計算しました。商品で量が違うときは直してください
                  </p>
                )}
                {row.unknown && (
                  <div className="flex flex-col gap-1 pl-6 text-xs text-muted-foreground">
                    <p>
                      レシピの分量は「{row.amountText || '分量不明'}」です。使った量を入れたときだけ在庫から引きます
                    </p>
                    {Number(row.quantity) > 0 && parseAmount(row.amountText ?? '').quantity != null && parseAmount(row.amountText ?? '').unit && (
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" className="size-3.5" checked={Boolean(row.remember)} onChange={(e) => updatePlan(row.key, { remember: e.target.checked })} />
                        次から「{row.amountText}」を {row.quantity}
                        {row.unit} として覚える
                      </label>
                    )}
                  </div>
                )}
              </div>
            ))}
            {status.shortfalls.length > 0 && (
              <p className="text-xs text-destructive">不足のまま作ります: {describeShortfalls(status.shortfalls, 5)}(在庫のある分だけ差し引きます)</p>
            )}
            <p className="text-xs text-muted-foreground">在庫より多い分は差し引きません。24時間以内なら「取り消す」で元に戻せます</p>
            {cookError && <p className="text-sm text-destructive">{cookError}</p>}
          </div>
          <SheetFooter className="flex-row gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setCookOpen(false)}>
              キャンセル
            </Button>
            <Button className="flex-1" onClick={handleCook} disabled={saving}>
              {saving ? '確定中...' : '確定'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
