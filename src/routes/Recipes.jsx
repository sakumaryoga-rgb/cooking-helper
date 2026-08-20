import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { sortRecipesByMakeability } from '@/lib/matching'
import { Button } from '@/components/ui/button'
import { MakeableBadge } from '@/components/MakeableBadge'

export function Recipes({ groupId }) {
  const { ingredients } = useIngredients(groupId)
  const { recipes, loading } = useRecipes(groupId)

  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const sorted = useMemo(
    () => sortRecipesByMakeability(recipes, ingredientsById),
    [recipes, ingredientsById]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-medium">レシピ</h1>
        <Button asChild size="sm">
          <Link to="/recipes/new">
            <Plus className="size-4" />
            追加
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          まだレシピがありません。「追加」から登録しましょう。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border">
          {sorted.map(({ recipe, status }) => (
            <li key={recipe.id}>
              <Link
                to={`/recipes/${recipe.id}`}
                className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-accent/50 transition-colors"
              >
                <span className="text-sm font-medium truncate">{recipe.title}</span>
                <MakeableBadge status={status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
