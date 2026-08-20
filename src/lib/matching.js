// レシピが「今の冷蔵庫の中身で作れるか」を判定するロジック。
// ingredientsById: Map<ingredientId, { id, name, unit, quantity }> (useIngredients の最新の在庫)
// recipe: { id, title, recipe_ingredients: [{ ingredient_id, required_quantity, ingredient }] }

export function getRecipeStatus(recipe, ingredientsById) {
  const shortfalls = []

  for (const req of recipe.recipe_ingredients ?? []) {
    const current = ingredientsById.get(req.ingredient_id)
    const currentQuantity = current?.quantity ?? 0
    const name = current?.name ?? req.ingredient?.name ?? '(不明な食材)'
    const unit = current?.unit ?? req.ingredient?.unit ?? ''

    if (currentQuantity < req.required_quantity) {
      shortfalls.push({
        ingredientId: req.ingredient_id,
        name,
        unit,
        requiredQuantity: req.required_quantity,
        currentQuantity,
      })
    }
  }

  return {
    makeable: shortfalls.length === 0,
    shortfallCount: shortfalls.length,
    shortfalls,
  }
}

// 「作れる」レシピを先頭に、それ以外は不足数が少ない順に並べ替える
export function sortRecipesByMakeability(recipes, ingredientsById) {
  return recipes
    .map((recipe) => ({ recipe, status: getRecipeStatus(recipe, ingredientsById) }))
    .sort((a, b) => {
      if (a.status.makeable !== b.status.makeable) {
        return a.status.makeable ? -1 : 1
      }
      return a.status.shortfallCount - b.status.shortfallCount
    })
}
