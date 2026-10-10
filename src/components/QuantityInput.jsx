import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { formatQuantity, parseQuantity, withFraction } from '@/lib/quantity'
import { cn } from '@/lib/utils'

const FRACTIONS = [
  { label: '½', value: [1, 2] },
  { label: '⅓', value: [1, 3] },
  { label: '⅔', value: [2, 3] },
  { label: '¼', value: [1, 4] },
  { label: '¾', value: [3, 4] },
]

// 数量の入力欄。「1/2」「½」「1と1/2」「0.5」のどれでも入れられる。
// 親には小数の文字列で渡す(1/2 → "0.5"、読めない間は "")ので、親はこれまでどおり Number() で扱える。
// fractions: 'focus' は入力中だけ分数ボタンを出す、'always' は常に出す、'none' は出さない
export function QuantityInput({ value, onChange, fractions = 'focus', suffix, className, wrapperClassName, ...props }) {
  const [text, setText] = useState(() => toText(value))
  const [focused, setFocused] = useState(false)
  // 親の値が外から変わったとき(初期化・人数の変更など)は表示を合わせる
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (String(parseQuantity(text) ?? '') !== String(value ?? '')) setText(toText(value))
  }

  function update(next) {
    setText(next)
    const n = parseQuantity(next)
    const out = n == null ? '' : String(n)
    setSeen(out)
    onChange(out)
  }

  const showFractions = fractions === 'always' || (fractions === 'focus' && focused)
  const parsed = parseQuantity(text)
  const hint = parsed != null && /[/½⅓⅔¼¾と]|半/.test(text) ? `= ${formatDecimal(parsed)}` : null

  return (
    <span className={cn('relative inline-flex flex-col gap-1.5', wrapperClassName)}>
      <span className="flex items-center gap-2">
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={className}
        value={text}
        onChange={(e) => update(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-invalid={text.trim() !== '' && parsed == null ? true : undefined}
        {...props}
      />
      {suffix}
      </span>
      {showFractions && (
        <span
          className={cn(
            'flex items-center gap-1',
            fractions === 'focus' && 'absolute right-0 top-full z-20 mt-1 rounded-xl border bg-popover p-1 shadow-md'
          )}
        >
          {FRACTIONS.map((f) => (
            <button
              key={f.label}
              type="button"
              // 入力欄のフォーカスを外さない(外すとボタンが消えてタップが届かない)
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => update(withFraction(text, f.value))}
              className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-muted px-1.5 text-sm font-medium hover:bg-primary hover:text-primary-foreground"
              aria-label={`端数を${f.value[0]}/${f.value[1]}にする`}
            >
              {f.label}
            </button>
          ))}
        </span>
      )}
      {hint && fractions === 'always' && <span className="mt-1 text-[11px] text-muted-foreground">{hint}</span>}
    </span>
  )
}

function toText(value) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? formatQuantity(n) : String(value)
}

function formatDecimal(n) {
  return String(Math.round(n * 100) / 100)
}
