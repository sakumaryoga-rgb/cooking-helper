import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ExternalLink, Check, ChefHat } from 'lucide-react'
import { useIngredients } from '@/hooks/useIngredients'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useSubstitutions } from '@/hooks/useSubstitutions'
import { useCookLogs } from '@/hooks/useCookLogs'
import { useRecipes } from '@/hooks/useRecipes'
import { buildCookPlan, describeShortfalls, getRecipeStatus } from '@/lib/matching'
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
  const { catalog } = useIngredientCatalog()
  const { rules: substitutions, disableRule } = useSubstitutions(groupId)
  const { logs, refresh: refreshLogs } = useCookLogs(id)
  const [cookOpen, setCookOpen] = useState(false)
  const [plan, setPlan] = useState([])
  const [requestId, setRequestId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [cookError, setCookError] = useState('')
  const [undoingId, setUndoingId] = useState(null)

  // 調理の確定ダイアログを開いている間は、アプリの更新でリロードされないようにする
  useEffect(() => {
    setBusy('cook-dialog', cookOpen)
    return () => setBusy('cook-dialog', false)
  }, [cookOpen])

  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const recipe = recipes.find((r) => r.id === id)
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])
  const status = recipe ? getRecipeStatus(recipe, ingredientsById, { substitutions, catalogById }) : null

  // 塩・しょうゆなどを常備品にすると、在庫の数量に関係なく「ある」とみなす(家庭ごと)
  async function toggleStaple(ingredient) {
    const { error } = await supabase.from('ingredients').update({ is_staple: !ingredient.is_staple }).eq('id', ingredient.id)
    if (error) console.error('常備品の切り替えに失敗しました', error)
    refreshIngredients()
  }

  function openCookDialog() {
    setPlan(buildCookPlan(status))
    // 確定ボタンの連打や再送でも1回分だけ差し引くための ID(ダイアログを開くたびに作り直す)
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
    const items = plan
      .filter((row) => row.include && Number(row.quantity) > 0)
      .map((row) => ({ ingredient_id: row.ingredientId, quantity: Number(row.quantity), substitute_for: row.substituteFor }))
    const { error } = await supabase.rpc('cook_recipe_v2', { p_recipe_id: recipe.id, p_items: items, p_request_id: requestId })
    setSaving(false)
    if (error) {
      setCookError('在庫を更新できませんでした。もう一度お試しください')
      return
    }
    setCookOpen(false)
    refreshIngredients()
    refreshLogs()
  }

  async function handleUndo(logId) {
    setUndoingId(logId)
    const { error } = await supabase.rpc('undo_cook', { p_cook_log_id: logId })
    setUndoingId(null)
    if (error) console.error('取り消しに失敗しました', error)
    refreshIngredients()
    refreshLogs()
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
              {status.lines
                .find((l) => l.ingredientId === ri.ingredient_id)
                ?.substitutes.map((sub) => (
                  <div key={sub.ruleId} className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1 text-xs">
                    <span>
                      代わりに {sub.name} {formatQuantity(sub.quantity)}
                      {sub.unit}
                      {sub.note && <span className="text-muted-foreground">({sub.note})</span>}
                    </span>
                    <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => disableRule(sub.ruleId)}>
                      この代替を使わない
                    </button>
                  </div>
                ))}
              {ri.raw_text && <p className="text-xs text-muted-foreground">元の表記: {ri.raw_text}</p>}
            </li>
          )
        })}
      </ul>

      <Button onClick={openCookDialog}>
        <ChefHat className="size-4" />
        これを作る
      </Button>

      {logs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">最近作った記録</h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border">
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

      <Dialog open={cookOpen} onOpenChange={setCookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>使用した材料を確認</DialogTitle>
            <DialogDescription>実際に使った分量に調整できます</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
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
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="w-20 h-8"
                    value={row.quantity}
                    onChange={(e) => updatePlan(row.key, { quantity: e.target.value })}
                    aria-label={`${row.name}の使用量`}
                  />
                  <span className="text-xs text-muted-foreground w-8">{row.unit}</span>
                </div>
                {row.substituteFor && (
                  <p className="pl-6 text-xs text-amber-700 dark:text-amber-400">{row.substituteFor}の代わり(使わない場合はチェックを外す)</p>
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">在庫より多い分は差し引きません。あとから「取り消す」で元に戻せます</p>
            {cookError && <p className="text-sm text-destructive">{cookError}</p>}
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
