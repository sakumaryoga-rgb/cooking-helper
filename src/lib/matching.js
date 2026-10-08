// レシピが「今の冷蔵庫の中身で作れるか」を判定するロジック。
// ingredientsById: Map<ingredientId, { id, name, unit, quantity, is_staple }> (useIngredients の最新の在庫)
// recipe: { id, title, recipe_ingredients: [{ ingredient_id, required_quantity, ingredient }] }
//
// - 常備品(is_staple)は在庫の数量に関係なく「ある」とみなす(塩・しょうゆなど)。
// - 数量は小数の誤差を吸収して比べる(0.1 + 0.2 と 0.3 を同じとみなす)。
// - 不足は「あと何 単位」(必要量 - 在庫)で返す。
// - level: 'makeable'(作れる)/ 'almost'(不足が1〜2品)/ 'short'(3品以上)/ 'empty'(材料が未登録)

const EPSILON = 1e-6

function round(n) {
  return Math.round(n * 100) / 100
}

export function getRecipeStatus(recipe, ingredientsById) {
  const items = recipe.recipe_ingredients ?? []
  const shortfalls = []
  let stapleCount = 0

  for (const req of items) {
    const current = ingredientsById.get(req.ingredient_id)
    const required = Number(req.required_quantity) || 0
    const currentQuantity = Number(current?.quantity) || 0
    const name = current?.name ?? req.ingredient?.name ?? '(不明な食材)'
    const unit = current?.unit ?? req.ingredient?.unit ?? ''

    if (current?.is_staple) {
      stapleCount += 1
      continue
    }
    if (currentQuantity + EPSILON < required) {
      shortfalls.push({
        ingredientId: req.ingredient_id,
        name,
        unit,
        requiredQuantity: required,
        currentQuantity,
        missingQuantity: round(required - currentQuantity),
      })
    }
  }

  const makeable = items.length > 0 && shortfalls.length === 0
  const level = items.length === 0 ? 'empty' : makeable ? 'makeable' : shortfalls.length <= 2 ? 'almost' : 'short'

  return {
    makeable,
    level,
    shortfallCount: shortfalls.length,
    shortfalls,
    stapleCount,
    // 必要な材料のうち揃っている割合(常備品を含む)。並べ替えに使う
    readiness: items.length === 0 ? 0 : (items.length - shortfalls.length) / items.length,
  }
}

const LEVEL_ORDER = { makeable: 0, almost: 1, short: 2, empty: 3 }

// 作れる → あと少し → 不足が多い → 材料未登録 の順。同じ段階では不足の品数が少なく、揃っている割合が高い順
export function sortRecipesByMakeability(recipes, ingredientsById) {
  return recipes
    .map((recipe) => ({ recipe, status: getRecipeStatus(recipe, ingredientsById) }))
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.status.level] - LEVEL_ORDER[b.status.level] ||
        a.status.shortfallCount - b.status.shortfallCount ||
        b.status.readiness - a.status.readiness
    )
}

// 「にんじん あと1本、玉ねぎ あと0.5個」のような短い説明
export function describeShortfalls(shortfalls, limit = 3) {
  const parts = shortfalls.slice(0, limit).map((s) => `${s.name} あと${formatAmount(s.missingQuantity)}${s.unit}`)
  if (shortfalls.length > limit) parts.push(`ほか${shortfalls.length - limit}品`)
  return parts.join('、')
}

function formatAmount(n) {
  return String(Math.round(n * 100) / 100)
}
