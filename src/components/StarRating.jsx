import { Star } from 'lucide-react'

// 星1つぶん(0〜1 の塗り)
function StarShape({ fill, className }) {
  return (
    <span className={`relative inline-block ${className}`} aria-hidden="true">
      <Star className="absolute inset-0 size-full text-amber-300/70" strokeWidth={1.8} />
      {fill > 0 && (
        <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
          <Star className="size-full fill-amber-400 text-amber-500" strokeWidth={1.8} />
        </span>
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

// 評価を付ける: 星の左半分で 0.5、右半分で 1(0.5〜5 の十段階)。同じ値をもう一度押すと評価を外す
export function StarRatingInput({ value, onChange, disabled = false }) {
  const v = value == null ? 0 : Number(value)
  const choose = (next) => onChange(next === v ? null : next)
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center" role="radiogroup" aria-label="このレシピの評価">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="relative inline-block size-8">
            <StarShape className="size-8" fill={Math.max(0, Math.min(1, v - (i - 1)))} />
            {[i - 0.5, i].map((step, half) => (
              <button
                key={step}
                type="button"
                role="radio"
                aria-checked={v === step}
                aria-label={`評価 ${step}`}
                disabled={disabled}
                onClick={() => choose(step)}
                className={`absolute inset-y-0 ${half === 0 ? 'left-0' : 'right-0'} w-1/2 rounded-sm focus-visible:outline-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed`}
              />
            ))}
          </span>
        ))}
      </div>
      <span className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">{v > 0 ? v.toFixed(1) : '未評価'}</span>
    </div>
  )
}
