import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChefHat, Plus } from 'lucide-react'
import { useKitchen } from '@/hooks/useKitchen'
import { useIngredientBatches } from '@/hooks/useIngredientBatches'
import { describeSubstitutes } from '@/lib/matching'
import { describeExpiry, getExpiryInfo, getExpiryState } from '@/lib/shelfLife'
import { buttonVariants } from '@/components/ui/button'
import { MakeableBadge } from '@/components/MakeableBadge'

const EXPIRING_DAYS = 3

function RecipeSection({ title, items, empty, detail }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        {title}
        <span className="ml-1 text-muted-foreground">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card">
          {items.map(({ recipe, status }) => (
            <li key={recipe.id}>
              <Link to={`/recipes/${recipe.id}`} className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-accent/50">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{recipe.title}</span>
                  {detail && <span className="truncate text-xs text-muted-foreground">{detail(status)}</span>}
                </span>
                <MakeableBadge status={status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
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

  return (
    <div className="flex flex-col gap-6">
      <RecipeSection title="今すぐ作れる" items={makeable} empty="今の在庫だけで作れるレシピはありません" />
      <RecipeSection
        title="代替で作れる"
        items={substitutable}
        empty="代わりの食材で作れるレシピはありません"
        detail={(status) => describeSubstitutes(status.lines)}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          期限が{EXPIRING_DAYS}日以内の食材
          <span className="ml-1 text-muted-foreground">{expiring.length}</span>
        </h2>
        {expiring.length === 0 ? (
          <p className="text-sm text-muted-foreground">期限が近い食材はありません</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card">
            {expiring.map(({ ingredient, expiry }) => (
              <li key={ingredient.id}>
                <Link to="/fridge?filter=expiring" className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-accent/50">
                  <span className="truncate">{ingredient.name}</span>
                  <span className={getExpiryState(expiry) === 'expired' ? 'text-destructive text-xs font-medium' : 'text-amber-700 text-xs dark:text-amber-400'}>
                    {describeExpiry(expiry)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Link to="/recipes" className={buttonVariants({ variant: 'outline' })}>
          <ChefHat className="size-4" />
          レシピを見る
        </Link>
        <Link to="/recipes/new" className={buttonVariants()}>
          <Plus className="size-4" />
          レシピを追加
        </Link>
      </div>
    </div>
  )
}
