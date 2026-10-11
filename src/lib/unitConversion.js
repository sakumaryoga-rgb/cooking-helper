// 分量の換算をひとつにまとめたもの。URL の取り込み・レシピの編集・作れるかの判定・「作った」の確認で同じ順に使う。
//
// 優先の順(上ほど確か):
//   1. 同じ単位
//   2. 計量の定義による厳密な換算(g⇔kg、ml⇔大さじ・小さじ・カップ・合)。確定に使ってよい
//   3. 家庭で確認した換算(ingredient_unit_conversions、migration 024)。確定に使ってよい
//   4. 全体共通の目安(ingredient_catalog_unit_conversions、migration 026)。候補として見せるだけで、
//      作れるかの断定や在庫の自動の差し引きには使わない(ユーザーが確かめたときだけ使い、家庭の換算として覚える)
//   5. どれもなければ換算しない(元の表記のまま)
import { roundQuantity } from '@/lib/quantity'

// migration 026 の measurement_units と同じ定義(計量の単位は変わらないので、アプリにも持つ)
export const MEASUREMENT_UNITS = {
  g: { dimension: 'mass', base: 1 },
  kg: { dimension: 'mass', base: 1000 },
  ml: { dimension: 'volume', base: 1 },
  cc: { dimension: 'volume', base: 1 },
  L: { dimension: 'volume', base: 1000 },
  小さじ: { dimension: 'volume', base: 5 },
  大さじ: { dimension: 'volume', base: 15 },
  カップ: { dimension: 'volume', base: 200 },
  合: { dimension: 'volume', base: 180 },
}

function normalizeUnit(unit) {
  if (!unit) return unit
  const u = String(unit).trim()
  if (/^kg$/i.test(u)) return 'kg'
  if (/^g$/i.test(u)) return 'g'
  if (/^ml$/i.test(u)) return 'ml'
  if (/^cc$/i.test(u)) return 'cc'
  if (/^l$/i.test(u) || u === 'リットル') return 'L'
  return u
}

// from の 1 単位が to でいくつか(同じ次元のときだけ)。換算できなければ null
export function exactFactor(from, to) {
  const a = MEASUREMENT_UNITS[normalizeUnit(from)]
  const b = MEASUREMENT_UNITS[normalizeUnit(to)]
  if (!a || !b || a.dimension !== b.dimension) return null
  return a.base / b.base
}

// 共通の換算の行を、食材マスタの ID ごとにまとめる
export function indexCommonConversions(rows) {
  const map = new Map()
  for (const r of rows ?? []) {
    if (r.is_active === false) continue
    if (!map.has(r.catalog_id)) map.set(r.catalog_id, [])
    map.get(r.catalog_id).push({
      ...r,
      from_quantity: Number(r.from_quantity) || 1,
      to_quantity: Number(r.to_quantity),
      min_quantity: r.min_quantity == null ? null : Number(r.min_quantity),
      max_quantity: r.max_quantity == null ? null : Number(r.max_quantity),
    })
  }
  return map
}

// 状態の指定(「切り身」「殻つき」など。レシピの注記)に合う目安を選ぶ。指定がなければ「一般」を先に
function pickRules(rules, state) {
  if (!state) return [...rules].sort((a, b) => (a.state_key === '一般' ? -1 : 0) - (b.state_key === '一般' ? -1 : 0))
  const s = String(state)
  const matched = rules.filter((r) => r.state_key === '一般' || s.includes(r.state_key) || r.state_key.split('・').some((k) => s.includes(k)))
  return matched.length > 0 ? matched : rules
}

// 共通の目安で、quantity unit を食材の単位(target)に直す。候補がなければ null
function commonEstimate(quantity, unit, target, rules, state) {
  for (const r of pickRules(rules, state)) {
    // レシピの単位 → 目安の単位(同じか、大さじ⇔小さじのような計量の定義)→ g/ml → 食材の単位
    const toFrom = normalizeUnit(unit) === normalizeUnit(r.from_unit) ? 1 : exactFactor(unit, r.from_unit)
    const toTarget = exactFactor(r.to_unit, target)
    if (toFrom != null && toTarget != null) {
      const per = (r.to_quantity / r.from_quantity) * toTarget
      return finish(quantity * toFrom, per, r)
    }
    // 逆向き: 食材の単位が目安の単位(本・個)で、レシピが g/ml のとき
    const fromTarget = normalizeUnit(target) === normalizeUnit(r.from_unit) ? 1 : exactFactor(r.from_unit, target)
    const fromRecipe = exactFactor(unit, r.to_unit)
    if (fromTarget != null && fromRecipe != null) {
      const grams = quantity * fromRecipe
      const q = (grams / r.to_quantity) * r.from_quantity * fromTarget
      const range =
        r.min_quantity && r.max_quantity
          ? [roundQuantity((grams / r.max_quantity) * r.from_quantity * fromTarget), roundQuantity((grams / r.min_quantity) * r.from_quantity * fromTarget)]
          : null
      return { quantity: roundQuantity(q), range, rule: r }
    }
  }
  return null
}

function finish(count, per, r) {
  const scale = per / r.to_quantity
  const range = r.min_quantity && r.max_quantity ? [roundQuantity(count * r.min_quantity * scale), roundQuantity(count * r.max_quantity * scale)] : null
  return { quantity: roundQuantity(count * per), range, rule: r }
}

/**
 * quantity unit(レシピの分量)を、食材の単位に直す。
 * ingredient: { id, unit, catalog_id }。household: Map<`${ingredientId}:${unit}`, 食材の単位での量>。common: indexCommonConversions の結果
 * 返り値: { quantity, kind: 'same' | 'exact' | 'household' | 'common', confirmed, range, rule } か null。
 * confirmed が false(共通の目安)のときは、作れるかの断定と在庫の自動の差し引きに使わない
 */
export function resolveConversion({ quantity, unit, ingredient, household, common, state }) {
  const q = Number(quantity)
  if (!(q > 0) || !unit || !ingredient?.unit) return null
  const target = ingredient.unit
  if (normalizeUnit(unit) === normalizeUnit(target)) return { quantity: roundQuantity(q), kind: 'same', confirmed: true }
  const factor = exactFactor(unit, target)
  if (factor != null) return { quantity: roundQuantity(q * factor), kind: 'exact', confirmed: true }
  const per = ingredient.id ? household?.get(`${ingredient.id}:${unit}`) : null
  if (per > 0) return { quantity: roundQuantity(q * per), kind: 'household', confirmed: true, per }
  const rules = ingredient.catalog_id ? common?.get(ingredient.catalog_id) : null
  if (rules?.length) {
    const est = commonEstimate(q, unit, target, rules, state)
    if (est) return { ...est, kind: 'common', confirmed: false }
  }
  return null
}

// 「目安: 1束 ≈ 100g(味の素パーク)」のような説明
const SOURCE_LABEL = {
  AJI_FOOD: '味の素パーク',
  AJI_COND: '味の素パーク',
  EATREAT_OIL: 'eat-treat',
  HIROSHIMA_CITY: '広島市',
  MAFF_EGG: '農林水産省',
}
export function describeEstimate(result, unit) {
  if (!result || result.kind !== 'common') return ''
  const r = result.rule
  const amount = r.min_quantity && r.max_quantity ? `${r.min_quantity}〜${r.max_quantity}` : `${r.to_quantity}`
  const state = r.state_key && r.state_key !== '一般' ? `・${r.state_key}` : ''
  const head = `${r.from_quantity === 1 ? '1' : r.from_quantity}${r.from_unit} ≈ ${amount}${r.to_unit}`
  return `目安 約${formatShort(result.quantity)}${unit}(${head}${state}・${SOURCE_LABEL[r.source_id] ?? r.source_id})`
}

function formatShort(n) {
  return String(Math.round(n * 100) / 100)
}
