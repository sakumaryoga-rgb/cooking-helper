import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useKitchen } from '@/hooks/useKitchen'
import { describeExpiring, describeShortfalls } from '@/lib/matching'
import { normalizeName } from '@/lib/recipeImport/match'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MakeableBadge } from '@/components/MakeableBadge'
import { dishLook } from '@/lib/foodLook'
import { CATEGORIES, categoryOf } from '@/lib/recipeCategory'

// 絞り込み: すべて / 作れる / 期限が近い / 要確認 / 買い足し
const FILTERS = [
  { id: 'all', label: 'すべて', emoji: '📖', match: () => true },
  { id: 'makeable', label: '作れる', emoji: '✨', match: (s) => s.level === 'makeable' },
  // 期限が近い食材を使うレシピ(作れるものから順に並ぶ)
  { id: 'expiring', label: '期限が近い', emoji: '⏰', match: (s) => s.expiring?.length > 0 },
  { id: 'check', label: '要確認', emoji: '🔍', match: (s) => s.level === 'check' },
  { id: 'short', label: '買い足し', emoji: '🛒', match: (s) => s.level === 'almost' || s.level === 'short' },
]

// 「買い足し」は足りない品数ごとに分ける(3品以上はまとめる)。少ないほど、買い物で少し足せば作れる
const SHORT_GROUPS = [
  { id: 1, title: 'あと1品で作れる', match: (n) => n === 1 },
  { id: 2, title: 'あと2品で作れる', match: (n) => n === 2 },
  { id: 3, title: 'あと3品以上', match: (n) => n >= 3 },
]

// あと1品のレシピの足りない食材を、作れるようになるレシピの数が多い順に(買い物のメモ)
function shoppingMemo(items) {
  const count = new Map()
  for (const { status } of items) {
    for (const s of status.shortfalls) count.set(s.name, (count.get(s.name) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
}

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
  // 料理のカテゴリ('all' はすべて。すべてのときはカテゴリごとにまとめて出す)
  const [genre, setGenre] = useState('all')

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, sorted.filter((s) => f.match(s.status)).length])), [sorted])
  const key = normalizeName(query)
  const active = FILTERS.find((f) => f.id === filter)
  // 状態の絞り込みと検索(カテゴリをまたぐ)をした結果。並びは「作れる」・期限優先のまま
  const matched = useMemo(
    () => sorted.filter(({ recipe, status }) => active.match(status) && matchesQuery(recipe, status, key)).map((s) => ({ ...s, genre: categoryOf(s.recipe) })),
    [sorted, active, key]
  )
  const genreCounts = useMemo(() => {
    const c = new Map()
    for (const s of matched) c.set(s.genre, (c.get(s.genre) ?? 0) + 1)
    return c
  }, [matched])
  const visible = genre === 'all' ? matched : matched.filter((s) => s.genre === genre)

  function renderCard({ recipe, status }) {
    return (
        <li key={recipe.id}>
          <Link
            to={`/recipes/${recipe.id}`}
            className="flex items-center gap-3 rounded-2xl border bg-card p-2.5 pr-3 shadow-sm transition-transform hover:-translate-y-0.5 active:scale-[0.99]"
          >
            <span className={`flex size-14 shrink-0 items-center justify-center rounded-xl text-3xl ${dishLook(recipe).bg}`} aria-hidden="true">
              {dishLook(recipe).emoji}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold truncate">{recipe.title}</span>
              {status.expiring?.length > 0 && (
                <span className="truncate text-xs font-medium text-amber-700 dark:text-amber-400">⏰ {describeExpiring(status.expiring)}を使える</span>
              )}
              {(status.level === 'almost' || status.level === 'short') && (
                <span className="text-xs text-destructive/90 truncate">{describeShortfalls(status.shortfalls, 3)}</span>
              )}
              {recipe.source_site && <span className="text-xs text-muted-foreground">{recipe.source_site}</span>}
            </span>
            <MakeableBadge status={status} />
          </Link>
        </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-1.5 text-xl font-bold">
            <span aria-hidden="true">📖</span>
            レシピ
          </h1>
          <p className="text-xs text-muted-foreground">わが家のレシピ帳・{sorted.length}品</p>
        </div>
        <Link to="/recipes/new" className={buttonVariants({ size: 'sm', className: 'rounded-full' })}>
          <Plus className="size-4" />
          追加
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input className="h-10 rounded-full pl-9" placeholder="料理名・材料・出典で検索" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="レシピを検索" />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="絞り込み">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${filter === f.id ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-sm' : 'bg-card text-muted-foreground'}`}
            onClick={() => setFilter(f.id)}
          >
            <span aria-hidden="true">{f.emoji}</span>
            {f.label} {counts[f.id]}
          </button>
        ))}
      </div>

      {sorted.length > 0 && (
        <div className="-mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="料理のカテゴリ">
          {[{ id: 'all', label: '全カテゴリ', emoji: '🗂️' }, ...CATEGORIES].map((c) => {
            const n = c.id === 'all' ? matched.length : genreCounts.get(c.id) ?? 0
            // 0件のカテゴリは出さない(選んでいるものは出す)
            if (c.id !== 'all' && n === 0 && genre !== c.id) return null
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={genre === c.id}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
                  genre === c.id ? 'border-foreground/70 bg-foreground font-semibold text-background' : 'bg-card text-muted-foreground'
                }`}
                onClick={() => setGenre(c.id)}
              >
                <span aria-hidden="true">{c.emoji}</span>
                {c.label} {n}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : sorted.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">まだレシピがありません。「追加」から登録しましょう。</p>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">条件に合うレシピはありません</p>
      ) : (
        filter === 'short' ? (
          <div className="flex flex-col gap-5">
            {SHORT_GROUPS.map((g) => {
              const items = visible.filter(({ status }) => g.match(status.shortfallCount))
              if (items.length === 0) return null
              const memo = g.id === 1 ? shoppingMemo(items) : null
              return (
                <section key={g.id} className="flex flex-col gap-2" aria-label={g.title}>
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    {g.title}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{items.length}</span>
                  </h2>
                  {memo && (
                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed dark:bg-amber-950/40">
                      <span className="font-semibold">買えば作れる: </span>
                      {memo.map(([name, n], i) => (
                        <span key={name}>
                          {i > 0 && '・'}
                          {name}
                          {n > 1 && <span className="text-muted-foreground">({n}品)</span>}
                        </span>
                      ))}
                    </p>
                  )}
                  <ul className="flex flex-col gap-2.5">{items.map(renderCard)}</ul>
                </section>
              )
            })}
          </div>
        ) : genre === 'all' && genreCounts.size > 1 ? (
          // すべてのカテゴリ: カテゴリごとにまとめる(カテゴリの中は「作れる」・期限優先の並びのまま)
          <div className="flex flex-col gap-5">
            {CATEGORIES.map((c) => {
              const items = visible.filter((s) => s.genre === c.id)
              if (items.length === 0) return null
              return (
                <section key={c.id} className="flex flex-col gap-2" aria-label={c.label}>
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    <span aria-hidden="true">{c.emoji}</span>
                    {c.label}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{items.length}</span>
                  </h2>
                  <ul className="flex flex-col gap-2.5">{items.map(renderCard)}</ul>
                </section>
              )
            })}
          </div>
        ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map(renderCard)}
        </ul>
        )
      )}
    </div>
  )
}
