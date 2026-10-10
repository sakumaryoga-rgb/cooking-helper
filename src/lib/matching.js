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
// - level: 'makeable'(作れる)/ 'substitutable'(代替で作れる)/ 'check'(在庫はあるが分量を確かめる・確認待ちの材料がある)/
//   'almost'(不足1〜2品)/ 'short'(3品以上)/ 'empty'(材料未登録)
// - 分量が数で分からない材料(「1パック」で食材の単位が g など): 家庭で覚えた換算があれば数に直す。
//   なければ、在庫があっても「作れる」と断定せず 'check' にする。在庫がなければ不足
// - 「少々」「適量」: 在庫があれば足りているとみなす(量を量らないため)
// - 確認待ちの材料(どの食材か未確定): 'check' にする

import { parseAmount } from '@/lib/recipeImport/ingredientLine'

const EPSILON = 1e-6
const VAGUE_TEXT = /適量|少々|適宜|お好み|好みで|ひとつまみ|少量|たっぷり/

// 数で分からない分量を、家庭で覚えた換算(1パック = 200g など)で数に直す。直せなければ null。
// 換算は「冷蔵庫の食材の行 × 単位」ごと(家ごとに別の行)で、食材・単位が完全に一致するときだけ使う。幅(1〜2パック)には使わない。
// scale: 人数を変えたときの倍率(元の分量の表記は人数を変えても変わらないため)
export function convertAmount(amountText, ingredientId, conversions, scale = 1) {
  if (!amountText || !ingredientId || !conversions?.size) return null
  const a = parseAmount(amountText)
  if (a.quantity == null || !a.unit || a.range) return null
  const per = conversions.get(`${ingredientId}:${a.unit}`)
  return per ? { quantity: round(a.quantity * per * scale), per, unit: a.unit } : null
}

function round(n) {
  return Math.round(n * 100) / 100
}

// options.choices: Map<材料の ingredientId, ruleId | 'none'>(詳細画面で選んだ代替。'none' は代替しない)
export function getRecipeStatus(recipe, ingredientsById, { substitutions = [], catalogById = new Map(), choices = new Map(), conversions = new Map() } = {}) {
  const items = recipe.recipe_ingredients ?? []
  const remaining = new Map([...ingredientsById.values()].map((i) => [i.id, Number(i.quantity) || 0]))
  const fridge = [...ingredientsById.values()]
  let stapleCount = 0

  // 1. そのものの在庫を割り当てる
  const lines = items.map((req) => {
    const current = ingredientsById.get(req.ingredient_id)
    const converted = req.required_quantity == null ? convertAmount(req.amount_text, req.ingredient_id, conversions, req.scale ?? 1) : null
    const known = req.required_quantity != null || converted != null
    const required = known ? Number(req.required_quantity ?? converted.quantity) || 0 : 0
    const line = {
      ingredientId: req.ingredient_id,
      name: current?.name ?? req.ingredient?.name ?? req.source_name ?? '(不明な食材)',
      unit: current?.unit ?? req.ingredient?.unit ?? '',
      requiredQuantity: required,
      currentQuantity: Number(current?.quantity) || 0,
      staple: Boolean(current?.is_staple),
      fromOriginal: 0,
      substitutes: [],
      candidates: [],
      missing: 0,
      // 確認待ち(どの食材か未確定)・分量が数で分からない・少々や適量
      pending: !req.ingredient_id,
      amountText: req.amount_text ?? null,
      amountUnknown: !known && !VAGUE_TEXT.test(req.amount_text ?? ''),
      vague: !known && VAGUE_TEXT.test(req.amount_text ?? ''),
      // 家庭で覚えた換算で数にした(包装量は商品ごとに違うことがあるので、調理のときに明示する)
      converted: converted ? { per: converted.per, unit: converted.unit } : null,
      note: req.note ?? null,
    }
    if (line.pending) return line
    if (!known) {
      // 数が分からない: 在庫(常備品を含む)があるかだけを見る。なければ不足
      const have = line.staple || (remaining.get(req.ingredient_id) ?? 0) > EPSILON
      if (line.staple) stapleCount += 1
      if (!have) line.missing = Infinity
      return line
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
    // 候補を集める(在庫が足りるかどうかも付ける)
    for (const rule of substitutions) {
      if (rule.from_catalog_id !== original.catalog_id) continue
      const toCatalog = catalogById.get(rule.to_catalog_id)
      const candidate = fridge.find(
        (i) => i.catalog_id === rule.to_catalog_id && i.id !== original.id && (!toCatalog || toCatalog.unit === i.unit)
      )
      if (!candidate) continue
      const need = round(line.missing * Number(rule.ratio))
      const have = candidate.is_staple ? Infinity : remaining.get(candidate.id) ?? 0
      line.candidates.push({
        ruleId: rule.id,
        ingredientId: candidate.id,
        name: candidate.name,
        unit: candidate.unit,
        quantity: need,
        note: rule.note ?? null,
        enough: have + EPSILON >= need,
        staple: Boolean(candidate.is_staple),
      })
    }
    const choice = choices.get(line.ingredientId)
    if (choice === 'none') continue
    const pick =
      (choice && line.candidates.find((c) => c.ruleId === choice && c.enough)) || line.candidates.find((c) => c.enough)
    if (!pick) continue
    if (!pick.staple) remaining.set(pick.ingredientId, (remaining.get(pick.ingredientId) ?? 0) - pick.quantity)
    line.substitutes.push({
      ingredientId: pick.ingredientId,
      name: pick.name,
      unit: pick.unit,
      quantity: pick.quantity,
      ruleId: pick.ruleId,
      note: pick.note,
    })
    line.missing = 0
  }

  const shortfalls = lines
    .filter((l) => !l.pending && l.missing > EPSILON)
    .map((l) => ({
      ingredientId: l.ingredientId,
      name: l.name,
      unit: l.unit,
      requiredQuantity: l.requiredQuantity,
      currentQuantity: l.currentQuantity,
      // 数が分からない分量は、足りない量も分からない(null)
      missingQuantity: Number.isFinite(l.missing) ? round(l.missing) : null,
      amountText: l.amountText,
    }))
  const pendingCount = lines.filter((l) => l.pending).length
  const uncertainCount = lines.filter((l) => !l.pending && l.amountUnknown && !(l.missing > EPSILON)).length
  const substituted = lines.some((l) => l.substitutes.length > 0)
  const level =
    items.length === 0
      ? 'empty'
      : shortfalls.length === 0
        ? pendingCount + uncertainCount > 0
          ? 'check'
          : substituted
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
    pendingCount,
    uncertainCount,
    readiness: items.length === 0 ? 0 : (items.length - shortfalls.length - pendingCount) / items.length,
  }
}

const LEVEL_ORDER = { makeable: 0, substitutable: 1, check: 2, almost: 3, short: 4, empty: 5 }

// 作れる → 代替で作れる → あと少し → 不足が多い → 材料未登録 の順。同じ段階では不足の品数が少なく、揃っている割合が高い順
// 同じ段階の中では、期限が近い食材(EXPIRING_DAYS 日以内)を使うレシピを先にする(期限の近い順、使う品数の多い順)。
// options.expiryById: Map<ingredientId, { daysLeft, kind }>(在庫のある食材の、いちばん近い期限)
export function sortRecipesByMakeability(recipes, ingredientsById, options = {}) {
  const expiryById = options.expiryById ?? new Map()
  return recipes
    .map((recipe) => {
      const status = getRecipeStatus(recipe, ingredientsById, options)
      return { recipe, status: { ...status, expiring: expiringUses(status, expiryById) } }
    })
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.status.level] - LEVEL_ORDER[b.status.level] ||
        soonest(a.status.expiring) - soonest(b.status.expiring) ||
        b.status.expiring.length - a.status.expiring.length ||
        a.status.shortfallCount - b.status.shortfallCount ||
        b.status.readiness - a.status.readiness
    )
}

export const EXPIRING_DAYS = 3

function soonest(expiring) {
  return expiring.length > 0 ? expiring[0].daysLeft : Infinity
}

// このレシピで在庫から使う食材(代替を含む)のうち、期限が近いもの。期限の近い順。
// 常備品と、消費期限が切れたもの(食べないほうがよい)は含めない
export function expiringUses(status, expiryById) {
  const seen = new Map()
  const consider = (ingredientId, name) => {
    const e = ingredientId ? expiryById.get(ingredientId) : null
    if (!e || e.daysLeft > EXPIRING_DAYS || (e.kind === 'use_by' && e.daysLeft < 0)) return
    if (!seen.has(ingredientId)) seen.set(ingredientId, { ingredientId, name, daysLeft: e.daysLeft, kind: e.kind })
  }
  for (const line of status.lines) {
    if (line.pending || line.staple) continue
    if (line.currentQuantity > 0) consider(line.ingredientId, line.name)
    for (const sub of line.substitutes) consider(sub.ingredientId, sub.name)
  }
  return [...seen.values()].sort((a, b) => a.daysLeft - b.daysLeft)
}

// 「にんじん(あと1日)・牛乳(本日まで)」のような短い説明
export function describeExpiring(expiring, limit = 2) {
  // 期限切れは種類で区別する(消費期限切れはそもそも勧めない)
  const label = (e) =>
    e.daysLeft < 0 ? (e.kind === 'best_before' ? '賞味期限切れ' : '推定の期限切れ') : e.daysLeft === 0 ? '本日まで' : `あと${e.daysLeft}日`
  const parts = expiring.slice(0, limit).map((e) => `${e.name}(${label(e)})`)
  if (expiring.length > limit) parts.push(`ほか${expiring.length - limit}品`)
  return parts.join('・')
}

// 「にんじん あと1本、玉ねぎ あと0.5個」のような短い説明
export function describeShortfalls(shortfalls, limit = 3) {
  const parts = shortfalls
    .slice(0, limit)
    .map((s) => (s.missingQuantity == null ? `${s.name}(在庫なし${s.amountText ? `・${s.amountText}` : ''})` : `${s.name} あと${round(s.missingQuantity)}${s.unit}`))
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
    // 確認待ち(食材が未確定)の材料は在庫から引かない
    if (line.pending) continue
    // 数が分からない分量(1パック・少々)は推測で引かない: 量を入れたときだけ引く
    if (line.amountUnknown || line.vague) {
      rows.push({
        key: `o:${line.ingredientId}`,
        ingredientId: line.ingredientId,
        name: line.name,
        unit: line.unit,
        quantity: '',
        include: false,
        substituteFor: null,
        amountText: line.amountText,
        unknown: true,
      })
      continue
    }
    const originalQuantity = line.substitutes.length > 0 ? line.fromOriginal : line.requiredQuantity
    if (originalQuantity > 0 || line.substitutes.length === 0) {
      rows.push({
        key: `o:${line.ingredientId}`,
        ingredientId: line.ingredientId,
        name: line.name,
        unit: line.unit,
        quantity: round(originalQuantity),
        // 常備品は数えないので、最初は在庫から引かない(引きたいときはチェックを入れる)
        include: !line.staple,
        staple: line.staple,
        substituteFor: null,
        converted: line.converted,
        amountText: line.amountText,
      })
    }
    for (const s of line.substitutes) {
      rows.push({ key: `s:${line.ingredientId}:${s.ingredientId}`, ingredientId: s.ingredientId, name: s.name, unit: s.unit, quantity: s.quantity, include: true, substituteFor: line.name, note: s.note })
    }
  }
  return rows
}

// 人数に合わせて必要量を変えたレシピ(factor = 作る人数 / 元の人数)
export function scaleRecipe(recipe, factor) {
  if (!recipe || !(factor > 0) || factor === 1) return recipe
  return {
    ...recipe,
    recipe_ingredients: (recipe.recipe_ingredients ?? []).map((ri) => ({
      ...ri,
      // 数が分からない分量は、人数を変えても数にしない(覚えた換算で数にするときに倍率を使う)
      required_quantity: ri.required_quantity == null ? null : round(Number(ri.required_quantity) * factor),
      scale: ri.required_quantity == null ? factor : undefined,
    })),
  }
}

// 調理のときに在庫から引かない材料(量を入れない限り)。確定画面で明示する
export function describeNotSubtracted(status, plan) {
  const pending = status.lines.filter((l) => l.pending).map((l) => l.name)
  const unknown = plan.filter((row) => row.unknown && !(row.include && Number(row.quantity) > 0)).map((row) => row.name)
  return { pending, unknown }
}
