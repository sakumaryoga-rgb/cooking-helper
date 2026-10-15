import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { useKitchen } from '@/hooks/useKitchen'
import { describeExpiring, describeShortfalls } from '@/lib/matching'
import { normalizeName } from '@/lib/recipeImport/match'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MakeableBadge } from '@/components/MakeableBadge'
import { dishLook } from '@/lib/foodLook'
import { CATEGORIES, categoryOf } from '@/lib/recipeCategory'

// 畳んだカテゴリ(この端末で覚える)
const COLLAPSED_KEY = 'cookdoor:recipeCategoriesCollapsed'

function readCollapsed() {
  try {
    const list = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(list) ? list : [])
  } catch {
    return new Set()
  }
}

function saveCollapsed(set) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* 覚えられなくても畳む・開くはできる */
  }
}

// 名前・材料・出典で検索する(カタカナとひらがなの違いは同じとみなす)
function matchesQuery(recipe, status, key) {
  if (!key) return true
  const fields = [recipe.title, recipe.source_site ?? '', ...status.lines.map((l) => l.name)]
  return fields.some((f) => normalizeName(f).includes(key))
}

// レシピ一覧: 料理のカテゴリ(和食・イタリアンなど)ごとにまとめ、カテゴリは畳める。
// カテゴリの中は「作れる」→ 期限が近い食材を使う → 足りない品数が少ない、の順(useKitchen の並び)
export function Recipes({ groupId }) {
  const { sorted, loading } = useKitchen(groupId)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const key = normalizeName(query)
  const groups = useMemo(() => {
    const byGenre = new Map(CATEGORIES.map((c) => [c.id, []]))
    for (const s of sorted) {
      if (!matchesQuery(s.recipe, s.status, key)) continue
      byGenre.get(categoryOf(s.recipe))?.push(s)
    }
    return CATEGORIES.map((c) => ({ ...c, items: byGenre.get(c.id) })).filter((g) => g.items.length > 0)
  }, [sorted, key])

  function toggle(id) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveCollapsed(next)
      return next
    })
  }

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

      {loading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : sorted.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">まだレシピがありません。「追加」から登録しましょう。</p>
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">「{query}」に合うレシピはありません</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => {
            // 検索中は、見つかったカテゴリをすべて開いて見せる
            const open = Boolean(key) || !collapsed.has(g.id)
            const makeable = g.items.filter((s) => s.status.makeable).length
            return (
              <section key={g.id} aria-label={g.label} className="overflow-hidden rounded-3xl border-2 border-[#3b2a1c] bg-[#fffdf5] shadow-[0_4px_0_#3b2a1c] dark:bg-card">
                <h2>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`genre-${g.id}`}
                    onClick={() => toggle(g.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${g.tone}`}
                  >
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-2xl text-xl ${g.badge}`} aria-hidden="true">
                      {g.emoji}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-base font-bold leading-tight">{g.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {g.items.length}品
                        {makeable > 0 && <span className="ml-1.5 font-medium text-emerald-700 dark:text-emerald-400">✨ 作れる {makeable}</span>}
                      </span>
                    </span>
                    <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                </h2>
                {open && (
                  <ul id={`genre-${g.id}`} className="flex flex-col gap-2 border-t-2 border-dashed border-[#3b2a1c]/25 p-2.5">
                    {g.items.map(renderCard)}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
