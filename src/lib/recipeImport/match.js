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

// 表記揺れの吸収(辞書 ingredient_aliases にない書き方も同じ食材とみなす)。
// 漢字とかな(じゃが芋 / じゃがいも / ジャガイモ)、「新」「国産」などの接頭語、大きさの表記をそろえたキーを作る
const KANJI_TO_KANA = [
  ['馬鈴薯', 'じゃがいも'], ['玉葱', 'たまねぎ'], ['玉ねぎ', 'たまねぎ'], ['人参', 'にんじん'], ['胡瓜', 'きゅうり'],
  ['茄子', 'なす'], ['生姜', 'しょうが'], ['大蒜', 'にんにく'], ['椎茸', 'しいたけ'], ['舞茸', 'まいたけ'], ['牛蒡', 'ごぼう'],
  ['蓮根', 'れんこん'], ['南瓜', 'かぼちゃ'], ['大根', 'だいこん'], ['白菜', 'はくさい'], ['小松菜', 'こまつな'],
  ['玉子', 'たまご'], ['鶏卵', 'たまご'], ['胡麻', 'ごま'], ['胡椒', 'こしょう'], ['醤油', 'しょうゆ'], ['味噌', 'みそ'],
  ['豆腐', 'とうふ'], ['挽き', 'ひき'], ['挽', 'ひき'], ['小間切れ', 'こまぎれ'], ['こま切れ', 'こまぎれ'],
  ['芋', 'いも'], ['葱', 'ねぎ'], ['茸', 'たけ'], ['蕪', 'かぶ'], ['韮', 'にら'], ['筍', 'たけのこ'],
  ['海老', 'えび'], ['烏賊', 'いか'], ['蛸', 'たこ'], ['鮭', 'さけ'], ['鯖', 'さば'], ['鰤', 'ぶり'], ['鱈', 'たら'],
  ['卵', 'たまご'],
]
const PREFIXES = ['新', '国産', '冷凍', '生', '皮付き', '皮つき', '無塩', '有塩', 'お好みの', '市販の']
const SIZE_SUFFIX = /(大|中|小|大きめ|小さめ)$/

export function canonicalName(name) {
  let n = normalizeName(name)
  for (const [kanji, kana] of KANJI_TO_KANA) n = n.split(kanji).join(kana)
  for (const p of PREFIXES) {
    if (n.length > p.length + 1 && n.startsWith(p)) {
      n = n.slice(p.length)
      break
    }
  }
  if (n.length > 2) n = n.replace(SIZE_SUFFIX, '')
  return n
}

function findByName(list, key, raw) {
  const exact = list.find((item) => normalizeName(item.name) === key)
  if (exact) return { item: exact, fuzzy: false }
  // 表記揺れをそろえて一致するもの(じゃが芋 → じゃがいも)
  const canon = canonicalName(raw ?? key)
  const variant = canon ? list.find((item) => canonicalName(item.name) === canon) : null
  if (variant) return { item: variant, fuzzy: false }
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

// 別名辞書(人参 → にんじん)で食材マスタの品目を探す
function findByAlias(aliases, catalog, key, raw) {
  const canon = canonicalName(raw ?? key)
  const hit = aliases.find((a) => normalizeName(a.alias) === key) ?? aliases.find((a) => canonicalName(a.alias) === canon)
  return hit ? catalog.find((c) => c.id === hit.catalog_id) ?? null : null
}

export function resolveIngredient(parsed, ingredients, catalog, aliases = []) {
  const key = normalizeName(parsed.name)
  const canon = key ? canonicalName(parsed.name) : ''
  const aliasItem = key ? findByAlias(aliases, catalog, key, parsed.name) : null
  // 冷蔵庫: 名前が同じもの(表記揺れを含む)→ 別名が指す品目と同じもの(マスタの ID か名前)→ 名前の末尾が一致するもの
  const exactFridge = key
    ? ingredients.find((i) => normalizeName(i.name) === key) ?? ingredients.find((i) => canonicalName(i.name) === canon)
    : null
  const aliasFridge =
    !exactFridge && aliasItem
      ? ingredients.find((i) => i.catalog_id === aliasItem.id || normalizeName(i.name) === normalizeName(aliasItem.name))
      : null
  const fromFridge = exactFridge
    ? { item: exactFridge, fuzzy: false }
    : aliasFridge
      ? { item: aliasFridge, fuzzy: false }
      : !aliasItem && key
        ? findByName(ingredients, key, parsed.name)
        : null
  const fromCatalog = fromFridge ? null : aliasItem ? { item: aliasItem, fuzzy: false } : key ? findByName(catalog, key, parsed.name) : null

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
    // 取り込んだときの名前(付け替えたときに、家庭の別名として覚える)
    sourceName: displayName(parsed.name),
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
