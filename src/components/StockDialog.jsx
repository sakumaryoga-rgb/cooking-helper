import { useEffect, useState } from 'react'
import { Hash, Infinity as InfinityIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { supabase } from '@/supabaseClient'
import { QuantityInput } from '@/components/QuantityInput'
import { parseQuantity } from '@/lib/quantity'

const KINDS = [
  { id: 'none', label: '期限なし' },
  { id: 'best_before', label: '賞味期限' },
  { id: 'use_by', label: '消費期限' },
]

// 期限つきで在庫を増やす。賞味期限と消費期限はどちらか一方だけを選ぶ。
// 量は「1/2」「½」「0.5」のどれでも入れられる(同じ数として保存する)。
// offerStaple のとき(冷蔵庫に新しく入れるとき)は、数えずに「常備品」として置く選択肢も出す。
// 調味料など stapleDefault の食材は、最初から常備品を選んでおく
export function StockDialog({ ingredient, defaultQuantity, datedToday, offerStaple = false, stapleDefault = false, onClose, onSaved }) {
  const [quantity, setQuantity] = useState(String(defaultQuantity ?? 1))
  const [staple, setStaple] = useState(offerStaple && stapleDefault)
  const [purchasedToday, setPurchasedToday] = useState(datedToday)
  const [kind, setKind] = useState('none')
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setQuantity(String(defaultQuantity ?? 1))
    setStaple(offerStaple && stapleDefault)
    setPurchasedToday(datedToday)
    setKind('none')
    setDate('')
    setError('')
  }, [ingredient?.id, defaultQuantity, datedToday, offerStaple, stapleDefault])

  async function handleSave() {
    if (staple) {
      setSaving(true)
      setError('')
      const { error: updateError } = await supabase.from('ingredients').update({ is_staple: true }).eq('id', ingredient.id)
      setSaving(false)
      if (updateError) {
        setError('常備品にできませんでした。もう一度お試しください')
        return
      }
      onSaved?.()
      onClose()
      return
    }
    const delta = parseQuantity(quantity)
    if (!(delta > 0)) {
      setError('増やす量を入力してください')
      return
    }
    if (kind !== 'none' && !date) {
      setError('期限の日付を入力してください')
      return
    }
    setSaving(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('adjust_stock', {
      p_ingredient_id: ingredient.id,
      p_delta: delta,
      p_dated_today: purchasedToday,
      p_best_before: kind === 'best_before' ? date : null,
      p_use_by: kind === 'use_by' ? date : null,
    })
    setSaving(false)
    if (rpcError) {
      setError('在庫を増やせませんでした。もう一度お試しください')
      return
    }
    onSaved?.()
    onClose()
  }

  return (
    <Dialog open={Boolean(ingredient)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ingredient?.name} を{offerStaple ? '冷蔵庫に入れる' : '増やす'}</DialogTitle>
          <DialogDescription>
            {staple ? '常備品は数を記録しません。レシピでは「ある」とみなします' : '量は 1/2 や 0.5 のように分数でも小数でも入れられます。期限は任意です'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {offerStaple && (
            <div role="radiogroup" aria-label="記録のしかた" className="grid grid-cols-2 gap-2">
              {[
                { id: false, Icon: Hash, title: '数を記録する', sub: '使った分だけ減らす' },
                { id: true, Icon: InfinityIcon, title: '常備品にする', sub: '調味料など。数えない' },
              ].map((o) => (
                <button
                  key={String(o.id)}
                  type="button"
                  role="radio"
                  aria-checked={staple === o.id}
                  onClick={() => setStaple(o.id)}
                  className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2 text-left transition-colors ${
                    staple === o.id ? 'border-primary bg-primary/15' : 'border-border'
                  }`}
                >
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    <o.Icon className="size-4" />
                    {o.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{o.sub}</span>
                </button>
              ))}
            </div>
          )}
          {!staple && (
          <>
          <div className="flex items-start gap-2">
            <Label htmlFor="stock-quantity" className="w-16 pt-2">
              量
            </Label>
            <QuantityInput
              id="stock-quantity"
              fractions="always"
              className="w-28"
              value={quantity}
              onChange={setQuantity}
              suffix={<span className="text-sm text-muted-foreground">{ingredient?.unit}</span>}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="stock-today">今日買った(購入日を記録)</Label>
            <Switch id="stock-today" checked={purchasedToday} onCheckedChange={setPurchasedToday} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>期限</Label>
            <div role="radiogroup" aria-label="期限の種類" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.id}
                  className={`rounded-md px-2 py-1.5 text-sm ${kind === k.id ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
                  onClick={() => setKind(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {kind !== 'none' && (
              <Input type="date" aria-label="期限の日付" value={date} onChange={(e) => setDate(e.target.value)} />
            )}
            {kind === 'none' && (
              <p className="text-xs text-muted-foreground">期限なしの場合、購入日と食材の日持ちから「推定」の期限を出します</p>
            )}
          </div>
          </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : staple ? '常備品にする' : '在庫を増やす'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
