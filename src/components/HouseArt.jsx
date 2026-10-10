import { BookOpen, Carrot, Egg, Fish, Refrigerator, Users } from 'lucide-react'

// 入口の家のイラスト。屋根はトマト、扉はブランドの黄色。open のときは扉が開いてフライパンがのぞく。
// floating のときは、家のまわりを食材がふわふわ浮かぶ
export function HouseArt({ open = true, floating = false }) {
  return (
    <span className="relative inline-flex">
      {floating && (
        <span aria-hidden="true">
          <Carrot className="absolute -left-9 top-6 size-7 animate-[float_3.2s_ease-in-out_infinite] text-orange-500" strokeWidth={2.2} />
          <Egg className="absolute -right-8 top-2 size-6 animate-[float_3.6s_ease-in-out_0.6s_infinite] text-amber-600" strokeWidth={2.2} />
          <Fish className="absolute -right-11 bottom-6 size-7 animate-[float_4s_ease-in-out_1.2s_infinite] text-sky-500" strokeWidth={2.2} />
        </span>
      )}
      <svg viewBox="0 0 160 120" className="h-32 w-auto drop-shadow-sm" aria-hidden="true">
        <ellipse cx="80" cy="112" rx="62" ry="6" fill="#3b2a1c" opacity="0.08" />
        <rect x="104" y="22" width="12" height="26" rx="2" fill="#c9b8a6" />
        <path d="M80 10 L144 58 L16 58 Z" fill="#e53d26" stroke="#3b2a1c" strokeWidth="3" strokeLinejoin="round" />
        <rect x="28" y="56" width="104" height="54" rx="4" fill="#fffdf7" stroke="#3b2a1c" strokeWidth="3" />
        <rect x="40" y="68" width="22" height="20" rx="3" fill="#fed712" opacity="0.35" stroke="#3b2a1c" strokeWidth="2.5" />
        <path d="M51 68 V88 M40 78 H62" stroke="#3b2a1c" strokeWidth="2" />
        <rect x="86" y="66" width="30" height="44" rx="3" fill="#3b2a1c" />
        <circle cx="101" cy="92" r="6" fill="#f2eae3" />
        <rect x="106" y="90" width="8" height="3" rx="1.5" fill="#f2eae3" />
        <g className={`origin-[86px_88px] ${open ? 'animate-[door-open_1.2s_ease-out_0.3s_both]' : ''}`}>
          <rect x="86" y="66" width="30" height="44" rx="3" fill="#fed712" stroke="#3b2a1c" strokeWidth="3" />
          <circle cx="110" cy="89" r="2.6" fill="#3b2a1c" />
        </g>
      </svg>
    </span>
  )
}

const FEATURES = [
  { Icon: Refrigerator, label: '冷蔵庫を記録' },
  { Icon: BookOpen, label: '作れるレシピ' },
  { Icon: Users, label: '家族と共有' },
]

export function FeatureChips() {
  return (
    <ul className="flex flex-wrap justify-center gap-2 pt-1">
      {FEATURES.map(({ Icon, label }) => (
        <li key={label} className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-border">
          <Icon className="size-3.5" />
          {label}
        </li>
      ))}
    </ul>
  )
}
