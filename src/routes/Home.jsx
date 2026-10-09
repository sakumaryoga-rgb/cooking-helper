import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Plus, Refrigerator } from 'lucide-react'
import { useKitchen } from '@/hooks/useKitchen'
import { useIngredientBatches } from '@/hooks/useIngredientBatches'
import { describeSubstitutes } from '@/lib/matching'
import { describeExpiry, getExpiryInfo, getExpiryState } from '@/lib/shelfLife'
import { categoryLook, dishLook, greeting } from '@/lib/foodLook'
import { MakeableBadge } from '@/components/MakeableBadge'

const EXPIRING_DAYS = 3

function SectionTitle({ emoji, title, count }) {
  return (
    <h2 className="flex items-center gap-1.5 text-base font-semibold">
      <span aria-hidden="true">{emoji}</span>
      {title}
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{count}</span>
    </h2>
  )
}

function Empty({ emoji, text }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 text-sm text-muted-foreground">
      <span className="text-2xl opacity-70" aria-hidden="true">
        {emoji}
      </span>
      {text}
    </div>
  )
}

// レシピのお皿カード(横にスクロール)
function DishCards({ items, detail }) {
  return (
    <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
      {items.map(({ recipe, status }) => {
        const look = dishLook(recipe)
        return (
          <li key={recipe.id} className="w-40 shrink-0 snap-start">
            <Link
              to={`/recipes/${recipe.id}`}
              className="flex h-full flex-col gap-2 rounded-2xl border bg-card p-3 shadow-sm transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <span className={`flex aspect-[4/3] items-center justify-center rounded-xl ${look.bg}`} aria-hidden="true">
                <span className="text-4xl drop-shadow-sm">{look.emoji}</span>
              </span>
              <span className="line-clamp-2 text-sm font-semibold leading-snug">{recipe.title}</span>
              {detail && <span className="line-clamp-2 text-[11px] text-muted-foreground">{detail(status)}</span>}
              <span className="mt-auto">
                <MakeableBadge status={status} />
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

// ホーム(設計書 4 章): 今すぐ作れる / 代替で作れる の2段と、期限が3日以内の食材。不足のあるレシピは出さない
export function Home({ groupId }) {
  const { sorted, ingredients, catalogById, loading } = useKitchen(groupId)
  const { batches } = useIngredientBatches(groupId)

  const makeable = sorted.filter((s) => s.status.level === 'makeable')
  const substitutable = sorted.filter((s) => s.status.level === 'substitutable')

  const expiring = useMemo(() => {
    const byIngredient = new Map()
    for (const b of batches) {
      if (!byIngredient.has(b.ingredient_id)) byIngredient.set(b.ingredient_id, [])
      byIngredient.get(b.ingredient_id).push(b)
    }
    return ingredients
      .filter((i) => Number(i.quantity) > 0)
      .map((i) => ({ ingredient: i, expiry: getExpiryInfo(i, byIngredient.get(i.id), catalogById) }))
      .filter((r) => r.expiry && r.expiry.daysLeft <= EXPIRING_DAYS)
      .sort((a, b) => a.expiry.daysLeft - b.expiry.daysLeft)
  }, [batches, ingredients, catalogById])

  if (loading) return <p className="text-sm text-muted-foreground">読み込み中...</p>

  const hello = greeting()
  const stock = ingredients.filter((i) => Number(i.quantity) > 0).length

  return (
    <div className="flex flex-col gap-6">
      {/* あいさつ */}
      <section className="relative overflow-hidden rounded-3xl bg-primary px-5 py-5 text-primary-foreground">
        <span className="pointer-events-none absolute right-3 top-3 rotate-12 select-none text-5xl" aria-hidden="true">
          🍳
        </span>
        <p className="text-xl font-bold">{hello.text}</p>
        <p className="mt-0.5 text-sm opacity-80">{hello.sub}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-background/70 px-2 py-2">
            <p className="text-2xl font-bold leading-none">{makeable.length}</p>
            <p className="mt-1 text-[11px] opacity-80">すぐ作れる</p>
          </div>
          <div className="rounded-2xl bg-background/70 px-2 py-2">
            <p className="text-2xl font-bold leading-none">{stock}</p>
            <p className="mt-1 text-[11px] opacity-80">冷蔵庫の食材</p>
          </div>
          <div className={`rounded-2xl px-2 py-2 ${expiring.length > 0 ? 'bg-brand-tomato text-white' : 'bg-background/70'}`}>
            <p className="text-2xl font-bold leading-none">{expiring.length}</p>
            <p className="mt-1 text-[11px] opacity-80">期限が近い</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle emoji="✨" title="今すぐ作れる" count={makeable.length} />
        {makeable.length === 0 ? <Empty emoji="🥄" text="今の在庫だけで作れるレシピはありません" /> : <DishCards items={makeable} />}
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle emoji="🔄" title="代替で作れる" count={substitutable.length} />
        {substitutable.length === 0 ? (
          <Empty emoji="🧩" text="代わりの食材で作れるレシピはありません" />
        ) : (
          <DishCards items={substitutable} detail={(status) => describeSubstitutes(status.lines)} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle emoji="⏰" title={`期限が${EXPIRING_DAYS}日以内の食材`} count={expiring.length} />
        {expiring.length === 0 ? (
          <Empty emoji="😌" text="期限が近い食材はありません" />
        ) : (
          <ul className="flex flex-col gap-2">
            {expiring.map(({ ingredient, expiry }) => {
              const look = categoryLook(catalogById.get(ingredient.catalog_id)?.category, ingredient.name)
              const expired = getExpiryState(expiry) === 'expired'
              return (
                <li key={ingredient.id}>
                  <Link
                    to="/fridge?filter=expiring"
                    className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 text-sm shadow-sm hover:bg-accent/50"
                  >
                    <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-lg ${look.bg}`} aria-hidden="true">
                      {look.emoji}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{ingredient.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        expired ? 'bg-destructive text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {describeExpiry(expiry)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-3 gap-2">
        <Link to="/recipes" className="flex flex-col items-center gap-1.5 rounded-2xl border bg-card px-2 py-3 text-xs font-medium shadow-sm hover:bg-accent/50">
          <BookOpen className="size-5 text-sky-600" />
          レシピを見る
        </Link>
        <Link to="/fridge" className="flex flex-col items-center gap-1.5 rounded-2xl border bg-card px-2 py-3 text-xs font-medium shadow-sm hover:bg-accent/50">
          <Refrigerator className="size-5 text-emerald-600" />
          冷蔵庫を開ける
        </Link>
        <Link to="/recipes/new" className="flex flex-col items-center gap-1.5 rounded-2xl bg-primary px-2 py-3 text-xs font-semibold text-primary-foreground shadow-sm">
          <Plus className="size-5" />
          レシピを追加
        </Link>
      </div>
    </div>
  )
}
