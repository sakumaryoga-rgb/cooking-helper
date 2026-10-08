import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { supabase } from '@/supabaseClient'

const KINDS = [
  { id: 'none', label: '期限なし' },
  { id: 'best_before', label: '賞味期限' },
  { id: 'use_by', label: '消費期限' },
]

// 期限つきで在庫を増やす。賞味期限と消費期限はどちらか一方だけを選ぶ
export function StockDialog({ ingredient, defaultQuantity, datedToday, onClose, onSaved }) {
  const [quantity, setQuantity] = useState(String(defaultQuantity ?? 1))
  const [purchasedToday, setPurchasedToday] = useState(datedToday)
  const [kind, setKind] = useState('none')
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setQuantity(String(defaultQuantity ?? 1))
    setPurchasedToday(datedToday)
    setKind('none')
    setDate('')
    setError('')
  }, [ingredient?.id, defaultQuantity, datedToday])

  async function handleSave() {
    const delta = Number(quantity)
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
          <DialogTitle>{ingredient?.name} を増やす</DialogTitle>
          <DialogDescription>期限は任意です。賞味期限か消費期限のどちらか一方を選べます</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="stock-quantity" className="w-16">
              量
            </Label>
            <Input id="stock-quantity" type="number" min="0" step="any" className="w-28" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            <span className="text-sm text-muted-foreground">{ingredient?.unit}</span>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '在庫を増やす'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
