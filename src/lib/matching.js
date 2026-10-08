// レシピが「今の冷蔵庫の中身で作れるか」を判定するロジック。
// ingredientsById: Map<ingredientId, { id, name, unit, quantity, is_staple, catalog_id }>(useIngredients の最新の在庫)
// recipe: { id, title, recipe_ingredients: [{ ingredient_id, required_quantity, ingredient }] }
// options.substitutions: 使える代替ルール [{ id, from_catalog_id, to_catalog_id, ratio, note }]
// options.catalogById: Map<catalogId, { unit }>(代替の単位が食材マスタの単位と合っているかの確認に使う)
//
// - 常備品(is_staple)は在庫の数量に関係なく「ある」とみなす。
// - 同じ在庫を複数の材料に重ねて割り当てない。まず全材料にそのものの在庫を割り当て、
//   足りない分だけ、残った在庫から代替を探す(代替がそのもの用の在庫を奪わない)。
// - 代替の必要量は ratio で換算する(単位は食材マスタの単位。冷蔵庫の行の単位と違う場合は代替しない)。
// - level: 'makeable'(作れる)/ 'substitutable'(代替で作れる)/ 'almost'(不足1〜2品)/ 'short'(3品以上)/ 'empty'(材料未登録)

const EPSILON = 1e-6

function round(n) {
  return Math.round(n * 100) / 100
}

export function getRecipeStatus(recipe, ingredientsById, { substitutions = [], catalogById = new Map() } = {}) {
  const items = recipe.recipe_ingredients ?? []
  const remaining = new Map([...ingredientsById.values()].map((i) => [i.id, Number(i.quantity) || 0]))
  const fridge = [...ingredientsById.values()]
  let stapleCount = 0

  // 1. そのものの在庫を割り当てる
  const lines = items.map((req) => {
    const current = ingredientsById.get(req.ingredient_id)
    const required = Number(req.required_quantity) || 0
    const line = {
      ingredientId: req.ingredient_id,
      name: current?.name ?? req.ingredient?.name ?? '(不明な食材)',
      unit: current?.unit ?? req.ingredient?.unit ?? '',
      requiredQuantity: required,
      currentQuantity: Number(current?.quantity) || 0,
      staple: Boolean(current?.is_staple),
      fromOriginal: 0,
      substitutes: [],
      missing: 0,
    }
    if (line.staple) {
      stapleCount += 1
      line.fromOriginal = required
      return line
    }
    const have = remaining.get(req.ingredient_id) ?? 0
    const take = Math.min(required, have)
    line.fromOriginal = round(take)
    line.missing = required - take > EPSILON ? required - take : 0
    if (current) remaining.set(current.id, have - take)
    return line
  })

  // 2. 足りない分を、残った在庫の代替で補う
  for (const line of lines) {
    if (line.missing <= EPSILON) continue
    const original = ingredientsById.get(line.ingredientId)
    const fromCatalog = original?.catalog_id ? catalogById.get(original.catalog_id) : null
    if (!original?.catalog_id || (fromCatalog && fromCatalog.unit !== original.unit)) continue
    for (const rule of substitutions) {
      if (rule.from_catalog_id !== original.catalog_id) continue
      const toCatalog = catalogById.get(rule.to_catalog_id)
      const candidate = fridge.find(
        (i) => i.catalog_id === rule.to_catalog_id && i.id !== original.id && (!toCatalog || toCatalog.unit === i.unit)
      )
      if (!candidate) continue
      const need = round(line.missing * Number(rule.ratio))
      const have = candidate.is_staple ? Infinity : remaining.get(candidate.id) ?? 0
      if (have + EPSILON < need) continue
      if (!candidate.is_staple) remaining.set(candidate.id, have - need)
      line.substitutes.push({
        ingredientId: candidate.id,
        name: candidate.name,
        unit: candidate.unit,
        quantity: need,
        ruleId: rule.id,
        note: rule.note ?? null,
      })
      line.missing = 0
      break
    }
  }

  const shortfalls = lines
    .filter((l) => l.missing > EPSILON)
    .map((l) => ({
      ingredientId: l.ingredientId,
      name: l.name,
      unit: l.unit,
      requiredQuantity: l.requiredQuantity,
      currentQuantity: l.currentQuantity,
      missingQuantity: round(l.missing),
    }))
  const substituted = lines.some((l) => l.substitutes.length > 0)
  const level =
    items.length === 0
      ? 'empty'
      : shortfalls.length === 0
        ? substituted
          ? 'substitutable'
          : 'makeable'
        : shortfalls.length <= 2
          ? 'almost'
          : 'short'

  return {
    makeable: level === 'makeable' || level === 'substitutable',
    level,
    shortfallCount: shortfalls.length,
    shortfalls,
    lines,
    stapleCount,
    readiness: items.length === 0 ? 0 : (items.length - shortfalls.length) / items.length,
  }
}

const LEVEL_ORDER = { makeable: 0, substitutable: 1, almost: 2, short: 3, empty: 4 }

// 作れる → 代替で作れる → あと少し → 不足が多い → 材料未登録 の順。同じ段階では不足の品数が少なく、揃っている割合が高い順
export function sortRecipesByMakeability(recipes, ingredientsById, options) {
  return recipes
    .map((recipe) => ({ recipe, status: getRecipeStatus(recipe, ingredientsById, options) }))
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.status.level] - LEVEL_ORDER[b.status.level] ||
        a.status.shortfallCount - b.status.shortfallCount ||
        b.status.readiness - a.status.readiness
    )
}

// 「にんじん あと1本、玉ねぎ あと0.5個」のような短い説明
export function describeShortfalls(shortfalls, limit = 3) {
  const parts = shortfalls.slice(0, limit).map((s) => `${s.name} あと${round(s.missingQuantity)}${s.unit}`)
  if (shortfalls.length > limit) parts.push(`ほか${shortfalls.length - limit}品`)
  return parts.join('、')
}

// 「鶏もも肉 → 鶏むね肉 100g」のような代替の説明
export function describeSubstitutes(lines, limit = 2) {
  const subs = lines.flatMap((l) => l.substitutes.map((s) => `${l.name}→${s.name} ${round(s.quantity)}${s.unit}`))
  const parts = subs.slice(0, limit)
  if (subs.length > limit) parts.push(`ほか${subs.length - limit}件`)
  return parts.join('、')
}

// 「作った」の確認画面の初期値。そのものは在庫から使える分(代替がない材料は必要量)、代替は換算した量
export function buildCookPlan(status) {
  const rows = []
  for (const line of status.lines) {
    const originalQuantity = line.substitutes.length > 0 ? line.fromOriginal : line.requiredQuantity
    if (originalQuantity > 0 || line.substitutes.length === 0) {
      rows.push({ key: `o:${line.ingredientId}`, ingredientId: line.ingredientId, name: line.name, unit: line.unit, quantity: round(originalQuantity), include: true, substituteFor: null })
    }
    for (const s of line.substitutes) {
      rows.push({ key: `s:${line.ingredientId}:${s.ingredientId}`, ingredientId: s.ingredientId, name: s.name, unit: s.unit, quantity: s.quantity, include: true, substituteFor: line.name, note: s.note })
    }
  }
  return rows
}
