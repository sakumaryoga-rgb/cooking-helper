import { useState } from 'react'
import { Building2, Castle, House, HouseHeart, HousePlus, KeyRound, Settings2, Sparkles, Tent, Warehouse } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// 家ごとの見た目(アイコンと色)。同じ家はいつも同じ見た目になるよう、家の ID から決める
const LOOKS = [
  { Icon: House, roof: 'bg-brand-yellow', tint: 'bg-brand-yellow/20', ink: 'text-[#3b2a1c]' },
  { Icon: HouseHeart, roof: 'bg-brand-tomato', tint: 'bg-brand-tomato/10', ink: 'text-white' },
  { Icon: Castle, roof: 'bg-sky-400', tint: 'bg-sky-100', ink: 'text-white' },
  { Icon: Tent, roof: 'bg-emerald-500', tint: 'bg-emerald-100', ink: 'text-white' },
  { Icon: Building2, roof: 'bg-violet-400', tint: 'bg-violet-100', ink: 'text-white' },
  { Icon: Warehouse, roof: 'bg-amber-700', tint: 'bg-amber-100', ink: 'text-white' },
]

export function houseLook(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return LOOKS[h % LOOKS.length]
}

export function HouseBadge({ id, className = 'size-9' }) {
  const { Icon, roof, ink } = houseLook(id)
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-xl ${roof} ${ink} ${className}`} aria-hidden="true">
      <Icon className="size-[60%]" strokeWidth={2.2} />
    </span>
  )
}

function HouseCard({ group, current, onSelect }) {
  const { tint } = houseLook(group.id)
  return (
    <button
      type="button"
      onClick={() => onSelect(group.id)}
      disabled={current}
      aria-pressed={current}
      className={`group relative flex w-full flex-col items-center gap-2 rounded-2xl border-2 p-3 pt-5 text-center transition-all ${
        current ? `border-primary ${tint} shadow-sm` : 'border-transparent bg-muted/60 hover:-translate-y-0.5 hover:bg-muted active:translate-y-0'
      }`}
    >
      {current ? (
        <span className="absolute -top-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
          <Sparkles className="size-3" />
          いまここ
        </span>
      ) : null}
      <HouseBadge id={group.id} className="size-12 transition-transform group-hover:scale-105" />
      <span className="line-clamp-2 text-sm font-medium leading-tight">{group.name}</span>
      <span className="text-[11px] text-muted-foreground">{current ? '在宅中' : 'この家に入る'}</span>
    </button>
  )
}

// 家の切り替え・新しい家を建てる・招待された家に入る
export function HouseSwitcher({ groups, currentId, onSelect, onManage, onCreate, onJoin, busy, message }) {
  const [mode, setMode] = useState(null) // null | 'create' | 'join'
  const [value, setValue] = useState('')
  const ordered = [...groups].sort((a, b) => (a.id === currentId ? -1 : b.id === currentId ? 1 : 0))

  async function submit(e) {
    e.preventDefault()
    const ok = mode === 'create' ? await onCreate(value) : await onJoin(value)
    if (ok) {
      setValue('')
      setMode(null)
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="わたしの家">
      <div className="flex items-end justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <House className="size-4.5" />
          わたしの家
        </h2>
        <span className="text-xs text-muted-foreground">{groups.length}軒</span>
      </div>
      <p className="text-xs text-muted-foreground">家を選ぶと、冷蔵庫・レシピ・作った記録がその家のものに切り替わります</p>

      <ul className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
        {ordered.map((g) => (
          <li key={g.id} className="relative flex">
            <HouseCard group={g} current={g.id === currentId} onSelect={onSelect} />
            {onManage && (
              <button
                type="button"
                onClick={() => onManage(g.id)}
                aria-label={`${g.name}の管理`}
                className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
              >
                <Settings2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
        <li className="flex">
          <button
            type="button"
            onClick={() => setMode(mode === 'create' ? null : 'create')}
            aria-expanded={mode === 'create'}
            aria-label="新しい家を建てる"
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-3 text-center text-sm text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <HousePlus className="size-7" />
            家を建てる
          </button>
        </li>
        <li className="flex">
          <button
            type="button"
            onClick={() => setMode(mode === 'join' ? null : 'join')}
            aria-expanded={mode === 'join'}
            aria-label="招待された家に入る"
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-3 text-center text-sm text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <KeyRound className="size-7" />
            招待で入る
          </button>
        </li>
      </ul>

      {mode && (
        <form onSubmit={submit} className="flex flex-col gap-2 rounded-2xl bg-muted/60 p-3">
          <label htmlFor="house-input" className="text-sm font-medium">
            {mode === 'create' ? '新しい家の名前' : '招待リンク'}
          </label>
          <div className="flex gap-2">
            <Input
              id="house-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === 'create' ? '例: 実家、シェアハウス' : 'もらった招待リンクを貼り付け'}
              maxLength={mode === 'create' ? 40 : undefined}
              autoComplete="off"
              autoFocus
            />
            <Button type="submit" disabled={busy || !value.trim()}>
              {mode === 'create' ? '建てる' : '入る'}
            </Button>
          </div>
        </form>
      )}
      {message && <p className="text-sm text-destructive">{message}</p>}
    </section>
  )
}
