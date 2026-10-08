import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useKitchen } from '@/hooks/useKitchen'
import { describeShortfalls, describeSubstitutes } from '@/lib/matching'
import { normalizeName } from '@/lib/recipeImport/match'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MakeableBadge } from '@/components/MakeableBadge'

// 絞り込み(設計書 4 章): 作れる / 代替で作れる / 不足あり / すべて
const FILTERS = [
  { id: 'all', label: 'すべて', match: () => true },
  { id: 'makeable', label: '作れる', match: (s) => s.level === 'makeable' },
  { id: 'substitutable', label: '代替で作れる', match: (s) => s.level === 'substitutable' },
  { id: 'short', label: '不足あり', match: (s) => s.level === 'almost' || s.level === 'short' },
]

// 名前・材料・出典で検索する(カタカナとひらがなの違いは同じとみなす)
function matchesQuery(recipe, status, key) {
  if (!key) return true
  const fields = [recipe.title, recipe.source_site ?? '', ...status.lines.map((l) => l.name)]
  return fields.some((f) => normalizeName(f).includes(key))
}

export function Recipes({ groupId }) {
  const { sorted, loading } = useKitchen(groupId)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, sorted.filter((s) => f.match(s.status)).length])), [sorted])
  const key = normalizeName(query)
  const active = FILTERS.find((f) => f.id === filter)
  const visible = sorted.filter(({ recipe, status }) => active.match(status) && matchesQuery(recipe, status, key))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-medium">レシピ</h1>
        <Link to="/recipes/new" className={buttonVariants({ size: 'sm' })}>
          <Plus className="size-4" />
          追加
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="料理名・材料・出典で検索" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="レシピを検索" />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="絞り込み">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${filter === f.id ? 'border-primary bg-primary text-primary-foreground font-medium' : 'bg-background text-muted-foreground'}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} {counts[f.id]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">まだレシピがありません。「追加」から登録しましょう。</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">条件に合うレシピはありません</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card">
          {visible.map(({ recipe, status }) => (
            <li key={recipe.id}>
              <Link to={`/recipes/${recipe.id}`} className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-accent/50 transition-colors">
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium truncate">{recipe.title}</span>
                  {status.level === 'substitutable' && (
                    <span className="text-xs text-muted-foreground truncate">{describeSubstitutes(status.lines)}</span>
                  )}
                  {(status.level === 'almost' || status.level === 'short') && (
                    <span className="text-xs text-destructive/90 truncate">{describeShortfalls(status.shortfalls, 3)}</span>
                  )}
                  {recipe.source_site && <span className="text-xs text-muted-foreground">{recipe.source_site}</span>}
                </span>
                <MakeableBadge status={status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
