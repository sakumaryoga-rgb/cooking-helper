// 取り込んだ材料を、冷蔵庫の食材(同じグループ)→ 食材マスタ の順に名前で突き合わせ、
// 保存先の食材と、その食材の単位での必要量を決める。決めきれないものは needsCheck にして画面で確かめてもらう。

const KNOWN_UNITS = ['g', 'ml', '個', '本', '枚', 'パック', '束', '玉', '尾', '切れ', '袋', '缶', '丁', '片', 'かけ', '株', '房', '節', '腹']

// 在庫で管理しないもの(最初は保存しない。画面でチェックすれば保存できる)
const NOT_STOCKED = ['水', 'お湯', '湯', '熱湯', '氷', '氷水', 'ゆで汁', '茹で汁', 'のゆで汁', 'の茹で汁', '戻し汁']

export function isNotStocked(name) {
  const n = String(name ?? '').normalize('NFKC').replace(/[(（[【][^)）\]】]*[)）\]】]/g, '').trim()
  return NOT_STOCKED.some((w) => n === w || (w.length >= 2 && n.endsWith(w)))
}

export function displayName(name) {
  const stripped = String(name ?? '').replace(/[(（[【][^)）\]】]*[)）\]】]/g, '').trim()
  return stripped || String(name ?? '').trim()
}

export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/[(（[【<＜][^)）\]】>＞]*[)）\]】>＞]/g, '')
    .replace(/[\s・]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
}

function findByName(list, key) {
  const exact = list.find((item) => normalizeName(item.name) === key)
  if (exact) return { item: exact, fuzzy: false }
  // 「薄切りハーフベーコン」→「ベーコン」のように、名前の末尾が一致する最も長いもの
  let best = null
  for (const item of list) {
    const n = normalizeName(item.name)
    if (n.length >= 2 && key.endsWith(n) && (!best || n.length > normalizeName(best.name).length)) best = item
  }
  return best ? { item: best, fuzzy: true } : null
}

// 解析した分量を、保存先の食材の単位に直す。直せなければ null
export function quantityInUnit(parsed, unit) {
  if (!parsed || parsed.vague) return null
  if (unit === 'g' && parsed.grams != null) return parsed.grams
  if (unit === 'ml' && parsed.ml != null) return parsed.ml
  if (parsed.quantity != null && parsed.unit === unit) return parsed.quantity
  return null
}

function guessUnit(parsed) {
  if (parsed.unit && KNOWN_UNITS.includes(parsed.unit)) return parsed.unit
  if (parsed.ml != null) return 'ml'
  if (parsed.grams != null) return 'g'
  return '個'
}

function round(n) {
  return Math.round(n * 100) / 100
}

export function resolveIngredient(parsed, ingredients, catalog) {
  const key = normalizeName(parsed.name)
  const fromFridge = key ? findByName(ingredients, key) : null
  const fromCatalog = !fromFridge && key ? findByName(catalog, key) : null

  let target
  if (fromFridge) {
    target = { kind: 'existing', ingredient: fromFridge.item, name: fromFridge.item.name, unit: fromFridge.item.unit, fuzzy: fromFridge.fuzzy }
  } else if (fromCatalog) {
    target = { kind: 'catalog', catalogItem: fromCatalog.item, name: fromCatalog.item.name, unit: fromCatalog.item.unit, fuzzy: fromCatalog.fuzzy }
  } else {
    target = { kind: 'new', name: displayName(parsed.name), unit: guessUnit(parsed), fuzzy: false }
  }

  const q = quantityInUnit(parsed, target.unit)
  return {
    ...target,
    requiredQuantity: q != null ? round(q) : parsed.vague ? '' : 1,
    // 「適量」「少々」は必要量を決められないので、最初は保存しない
    include: !parsed.vague && Boolean(parsed.name) && !isNotStocked(parsed.name),
    needsCheck: target.fuzzy || (q == null && !parsed.vague),
  }
}

// 同じ保存先(冷蔵庫の食材・マスタ・新しい名前)に向かう行を1つにまとめ、必要量を足す
export function mergeResolved(rows) {
  const merged = new Map()
  for (const row of rows) {
    if (!row.include) continue
    const key = row.kind === 'existing' ? `i:${row.ingredient.id}` : row.kind === 'catalog' ? `c:${row.catalogItem.id}` : `n:${normalizeName(row.name)}:${row.unit}`
    const qty = Number(row.requiredQuantity)
    const prev = merged.get(key)
    if (prev) prev.requiredQuantity = round(prev.requiredQuantity + (qty > 0 ? qty : 0))
    else merged.set(key, { ...row, requiredQuantity: qty > 0 ? qty : 0 })
  }
  return [...merged.values()].filter((r) => r.requiredQuantity > 0)
}
