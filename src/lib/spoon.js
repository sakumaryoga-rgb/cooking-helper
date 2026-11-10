// 調味料の分量を大さじ・小さじで入れる(元の表記「大さじ2」を残し、食材の単位に直せるときは数も持つ)
import { parseAmount } from '@/lib/recipeImport/ingredientLine'
import { describeEstimate, resolveConversion } from '@/lib/unitConversion'
import { isSeasoningItem } from '@/lib/recipeItems'

export const SPOONS = ['大さじ', '小さじ']
const ML = { 大さじ: 15, 小さじ: 5 }

function targetOf(item) {
  if (item.kind === 'existing' && item.ingredient) return { id: item.ingredient.id, unit: item.ingredient.unit, catalog_id: item.ingredient.catalog_id }
  if (item.kind === 'catalog' && item.catalogItem) return { unit: item.unit ?? item.catalogItem.unit, catalog_id: item.catalogItem.id }
  return item.unit ? { unit: item.unit } : null
}

function stateOf(item) {
  return [item.name, item.sourceName, item.note, item.rawText].filter(Boolean).join(' ')
}

// 大さじ・小さじを選んだときの材料の行の変更。食材の単位に計量の定義で直せるとき(ml など)は分量の数も入れる
export function spoonPatch(item, spoon, count) {
  const q = Number(count)
  const target = targetOf(item)
  const r = q > 0 && target ? resolveConversion({ quantity: q, unit: spoon, ingredient: target }) : null
  const exact = r && (r.kind === 'exact' || r.kind === 'same')
  return {
    spoon,
    spoonCount: count,
    amountText: q > 0 ? `${spoon}${count}` : '',
    requiredQuantity: exact ? String(r.quantity) : '',
    needsCheck: false,
  }
}

// 大さじ・小さじをやめて、食材の単位で入れる(直せるときは同じ量の数にする)
export function unspoonPatch(item) {
  const q = Number(item.spoonCount)
  const target = targetOf(item)
  const r = q > 0 && target && item.spoon ? resolveConversion({ quantity: q, unit: item.spoon, ingredient: target }) : null
  const exact = r && (r.kind === 'exact' || r.kind === 'same')
  return { spoon: null, spoonCount: '', amountText: '', requiredQuantity: exact ? String(r.quantity) : '1', needsCheck: false }
}

// 参考の量: 「= 30ml」、g の食材は「約36g(目安)」。common: 全体共通の目安(useCommonConversions)
export function spoonReference(item, common) {
  const q = Number(item.spoonCount)
  if (!item.spoon || !(q > 0)) return ''
  const ml = Math.round(q * ML[item.spoon] * 100) / 100
  const target = targetOf(item)
  if (!target || ['ml', 'cc'].includes(target.unit)) return `= ${ml}ml`
  const r = resolveConversion({ quantity: q, unit: item.spoon, ingredient: target, common, state: stateOf(item) })
  if (r?.kind === 'common') return `= ${ml}ml・${describeEstimate(r, target.unit)}`
  if (r && (r.kind === 'exact' || r.kind === 'household')) return `= ${ml}ml(約${r.quantity}${target.unit})`
  return `= ${ml}ml`
}

// 取り込んだ・保存した調味料の「大さじ2」を、大さじ・小さじの入力の形にする(調味料以外・幅のある量はそのまま)
export function withSpoon(item, catalogById = new Map()) {
  if (item.spoon || !item.amountText || !isSeasoningItem(item, catalogById)) return item
  // 「大さじ1〜2」のような幅は、元の表記のまま(1つの数にしない)
  if (/[〜~～]|から|-/.test(item.amountText)) return item
  const a = parseAmount(item.amountText)
  if (a.quantity == null || a.range || !SPOONS.includes(a.unit)) return item
  return { ...item, ...spoonPatch(item, a.unit, String(a.quantity)) }
}
