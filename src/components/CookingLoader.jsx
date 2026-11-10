import { cn } from '@/lib/utils'

// チャーハンの具(ご飯・卵・ねぎ・にんじん)。dx/dy: 飛ぶ向きと高さ、r: 回る角度、delay: 飛び出す遅れ(秒)
const BITS = [
  { left: 16, color: 'bg-amber-100', dx: -6, dy: -30, r: 160, delay: 0 },
  { left: 22, color: 'bg-yellow-300', dx: -2, dy: -40, r: -200, delay: 0.03 },
  { left: 28, color: 'bg-amber-50', dx: 3, dy: -34, r: 220, delay: 0.06 },
  { left: 34, color: 'bg-green-500', dx: 6, dy: -44, r: -160, delay: 0.02 },
  { left: 38, color: 'bg-amber-100', dx: 1, dy: -26, r: 140, delay: 0.08 },
  { left: 44, color: 'bg-orange-500', dx: 8, dy: -36, r: 240, delay: 0.04 },
  { left: 48, color: 'bg-yellow-300', dx: 4, dy: -30, r: -180, delay: 0.07 },
  { left: 26, color: 'bg-amber-50', dx: -4, dy: -22, r: 120, delay: 0.1 },
  { left: 40, color: 'bg-green-500', dx: -3, dy: -32, r: 200, delay: 0.05 },
]

// データの読み込み中に出す、フライパンでチャーハンを炒めるアニメーション
// (画面全体の読み込み・ページの読み込み・レシピの取り込みで共通)。動きを減らす設定では止まった絵になる
export function CookingLoader({ label = '読み込み中...', className, children }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex flex-col items-center gap-2 py-8 text-center', className)}>
      {children}
      <div className="relative h-20 w-24" aria-hidden="true">
        {/* 炒めて飛ぶ具 */}
        {BITS.map((b, i) => (
          <span
            key={i}
            className={`absolute bottom-[26px] h-1.5 w-2 rounded-full ${b.color} shadow-[0_0_0_0.5px_rgba(120,72,24,0.35)] animate-rice-toss`}
            style={{ left: b.left, '--dx': `${b.dx}px`, '--dy': `${b.dy}px`, '--r': `${b.r}deg`, animationDelay: `${b.delay}s` }}
          />
        ))}
        {/* フライパン(持ち手の根元を支点にあおる) */}
        <svg viewBox="0 0 96 28" className="absolute bottom-3 left-0 h-7 w-24 origin-[88%_50%] animate-pan-toss">
          <path d="M4 8 H64 Q62 24 46 25 H22 Q6 24 4 8 Z" fill="#3b2a1c" />
          <path d="M4 8 H64" stroke="#5c4330" strokeWidth="3" strokeLinecap="round" />
          <rect x="62" y="9" width="32" height="5" rx="2.5" fill="#7a4a2a" />
        </svg>
        {/* コンロの火 */}
        <div className="absolute bottom-0 left-[14px] flex gap-1.5">
          {[0, 0.15, 0.3, 0.1].map((d, i) => (
            <span key={i} className="h-3 w-2 rounded-t-full rounded-b-sm bg-gradient-to-t from-sky-500 to-orange-400 animate-flame" style={{ animationDelay: `${d}s` }} />
          ))}
        </div>
      </div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  )
}
