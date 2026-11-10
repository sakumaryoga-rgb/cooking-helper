import { Star } from 'lucide-react'

// 星1つぶん(0〜1 の塗り)
function StarShape({ fill, className }) {
  return (
    <span className={`relative inline-block ${className}`} aria-hidden="true">
      <Star className="absolute inset-0 size-full text-amber-300/70" strokeWidth={1.8} />
      {fill > 0 && (
        // 同じ大きさの星を左から fill の割合だけ見せる(0.5 は星の左半分)
        <Star
          className="absolute inset-0 size-full fill-amber-400 text-amber-500"
          strokeWidth={1.8}
          style={fill < 1 ? { clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` } : undefined}
        />
      )}
    </span>
  )
}

// 評価の表示だけ(カード用)。未評価なら何も出さない
export function StarRatingView({ value, className = 'size-3' }) {
  if (value == null) return null
  const v = Number(value)
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`評価 ${v}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarShape key={i} className={className} fill={Math.max(0, Math.min(1, v - (i - 1)))} />
      ))}
      <span className="ml-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{v.toFixed(1)}</span>
    </span>
  )
}

// 評価を付ける: 星を押すとその数(1〜5)。同じ星をもう一度押すと半分(4 → 3.5)、さらに押すと元に戻る。「外す」で未評価
export function StarRatingInput({ value, onChange, disabled = false }) {
  const v = value == null ? 0 : Number(value)
  const tap = (i) => onChange(v === i ? i - 0.5 : i)
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center" role="radiogroup" aria-label="このレシピの評価">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={Math.ceil(v) === i}
            aria-label={`星${i}つ`}
            disabled={disabled}
            onClick={() => tap(i)}
            className="rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed"
          >
            <StarShape className="size-8" fill={Math.max(0, Math.min(1, v - (i - 1)))} />
          </button>
        ))}
      </div>
      <span className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">{v > 0 ? v.toFixed(1) : '未評価'}</span>
      {v > 0 && (
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => onChange(null)} disabled={disabled}>
          外す
        </button>
      )}
    </div>
  )
}
