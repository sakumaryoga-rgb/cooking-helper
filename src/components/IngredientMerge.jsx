import { useMemo, useState } from 'react'
import { Combine } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { similarPairs } from '@/lib/ingredientMerge'
import { formatQuantity } from '@/lib/quantity'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

function stockText(i) {
  if (i.is_staple) return '常備品'
  return Number(i.quantity) > 0 ? `在庫 ${formatQuantity(i.quantity)}${i.unit}` : `在庫なし(${i.unit})`
}

// 2つの食材(冷蔵庫の行)を1つにまとめる。在庫・期限・レシピの材料を残す側に移し、まとめた名前を別名として覚える(migration 032)
export function IngredientMerge({ ingredients, initialKeepId = '', onMerged }) {
  const sorted = useMemo(() => [...(ingredients ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ja')), [ingredients])
  const pairs = useMemo(() => similarPairs(ingredients), [ingredients])
  const [keepId, setKeepId] = useState(initialKeepId)
  const [dropId, setDropId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const keep = sorted.find((i) => i.id === keepId)
  const drop = sorted.find((i) => i.id === dropId)
  const unitProblem = keep && drop && keep.unit !== drop.unit && Number(drop.quantity) > 0

  function choose(pair) {
    setKeepId(pair.keep.id)
    setDropId(pair.drop.id)
    setConfirming(true)
    setError('')
    setDone('')
  }

  async function merge() {
    setBusy(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('merge_ingredients', { p_keep: keep.id, p_drop: drop.id })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message?.startsWith('単位が違う') ? rpcError.message : '食材をまとめられませんでした。選んでいる家の食材か確かめてください')
      return
    }
    setDone(`「${drop.name}」を「${keep.name}」にまとめました。次から「${drop.name}」は自動で「${keep.name}」になります`)
    setConfirming(false)
    setDropId('')
    await onMerged?.()
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-3" aria-label="同じ食材をまとめる">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Combine className="size-4" />
          同じ食材をまとめる
        </h2>
        <p className="text-xs text-muted-foreground">
          「豚バラ」と「豚バラ肉」のように、同じ食材が別の名前で2つあるときに1つにします。在庫・期限・レシピの材料を移し、まとめた名前は次の取り込みから自動で残した食材になります
        </p>
      </div>

      {pairs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">同じ食材かもしれない組</p>
          <ul className="flex flex-wrap gap-1.5">
            {pairs.map((p) => (
              <li key={`${p.keep.id}:${p.drop.id}`}>
                <button
                  type="button"
                  className="rounded-full border bg-background px-2.5 py-1 text-xs hover:border-primary"
                  onClick={() => choose(p)}
                >
                  {p.drop.name} → {p.keep.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="merge-drop">まとめる(消える)食材</Label>
          <select
            id="merge-drop"
            className="h-10 rounded-lg border bg-background px-2 text-sm"
            value={dropId}
            onChange={(e) => {
              setDropId(e.target.value)
              setConfirming(false)
              setDone('')
            }}
          >
            <option value="">選んでください</option>
            {sorted.filter((i) => i.id !== keepId).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}({stockText(i)})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="merge-keep">残す食材</Label>
          <select
            id="merge-keep"
            className="h-10 rounded-lg border bg-background px-2 text-sm"
            value={keepId}
            onChange={(e) => {
              setKeepId(e.target.value)
              setConfirming(false)
              setDone('')
            }}
          >
            <option value="">選んでください</option>
            {sorted.filter((i) => i.id !== dropId).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}({stockText(i)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {unitProblem && (
        <p className="text-xs text-destructive">
          単位が違います({drop.unit}と{keep.unit})。「{drop.name}」の在庫を0にしてからまとめてください
        </p>
      )}

      {keep && drop && !unitProblem && !confirming && (
        <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
          「{drop.name}」を「{keep.name}」にまとめる
        </Button>
      )}

      {confirming && keep && drop && !unitProblem && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          <p>
            「{drop.name}」({stockText(drop)})を「{keep.name}」({stockText(keep)})にまとめます。
            {keep.unit === drop.unit && Number(drop.quantity) > 0 && `在庫は合わせて ${formatQuantity(Number(keep.quantity) + Number(drop.quantity))}${keep.unit} になります。`}
            「{drop.name}」の行は消え、元に戻せません
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={merge} disabled={busy}>
              まとめる
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              やめる
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {done}
        </p>
      )}
    </section>
  )
}
