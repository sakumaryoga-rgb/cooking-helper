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

// 迷わず決められるのは「名前が同じ」(かなの違い・かっこ書きは同じとみなす)と「別名辞書にある表記」だけ。
// それ以外(漢字とかなの違い、名前の一部が同じ など)は候補を出して、どの食材かをユーザーに選んでもらう
function exactAliasItem(aliases, catalog, key) {
  const hit = aliases.find((a) => normalizeName(a.alias) === key)
  return hit ? catalog.find((c) => c.id === hit.catalog_id) ?? null : null
}

function existingOption(ingredient) {
  return { kind: 'existing', ingredient, name: ingredient.name, unit: ingredient.unit }
}

function catalogOption(catalogItem) {
  return { kind: 'catalog', catalogItem, name: catalogItem.name, unit: catalogItem.unit }
}

// 似ている食材の候補(冷蔵庫の行を優先し、同じ品目は1つにまとめる)。近い順に最大4件
export function findCandidates(rawName, ingredients, catalog, aliases = []) {
  const key = normalizeName(rawName)
  const canon = canonicalName(rawName)
  if (!key) return []
  const score = (name) => {
    const n = normalizeName(name)
    const c = canonicalName(name)
    if (c === canon) return 1
    if (n.length >= 2 && (key.endsWith(n) || canon.endsWith(c))) return 2
    if (n.length >= 2 && (key.startsWith(n) || n.startsWith(key) || n.endsWith(key))) return 3
    if (c.length >= 2 && (canon.includes(c) || c.includes(canon))) return 4
    return 0
  }
  const aliasScore = (catalogId) => {
    const hit = aliases.find((a) => a.catalog_id === catalogId && canonicalName(a.alias) === canon)
    return hit ? 1 : 0
  }
  const options = []
  const seenCatalog = new Set()
  for (const i of ingredients) {
    const sc = score(i.name) || (i.catalog_id ? aliasScore(i.catalog_id) : 0)
    if (!sc) continue
    options.push({ ...existingOption(i), score: sc })
    if (i.catalog_id) seenCatalog.add(i.catalog_id)
  }
  for (const c of catalog) {
    if (seenCatalog.has(c.id) || ingredients.some((i) => i.name === c.name)) continue
    const sc = score(c.name) || aliasScore(c.id)
    if (sc) options.push({ ...catalogOption(c), score: sc })
  }
  return options
    .sort((x, y) => x.score - y.score || x.name.length - y.name.length)
    .slice(0, 4)
    .map(({ score: _, ...o }) => o)
}

// 決めた保存先で、必要量と確認の要否を計算する
function withQuantity(target, parsed) {
  const q = quantityInUnit(parsed, target.unit)
  return {
    ...target,
    requiredQuantity: q != null ? round(q) : parsed.vague ? '' : 1,
    needsCheck: q == null && !parsed.vague,
  }
}

export function resolveIngredient(parsed, ingredients, catalog, aliases = []) {
  const key = normalizeName(parsed.name)
  const aliasItem = key ? exactAliasItem(aliases, catalog, key) : null
  // 冷蔵庫: 名前が同じもの → 別名が指す品目と同じもの(マスタの ID か名前)。食材マスタ: 別名 → 名前が同じもの
  const exactFridge = key ? ingredients.find((i) => normalizeName(i.name) === key) : null
  const aliasFridge =
    !exactFridge && aliasItem
      ? ingredients.find((i) => i.catalog_id === aliasItem.id || normalizeName(i.name) === normalizeName(aliasItem.name))
      : null
  const exactCatalog = !exactFridge && !aliasFridge && !aliasItem && key ? catalog.find((c) => normalizeName(c.name) === key) : null
  const certain = exactFridge
    ? existingOption(exactFridge)
    : aliasFridge
      ? existingOption(aliasFridge)
      : aliasItem
        ? catalogOption(aliasItem)
        : exactCatalog
          ? catalogOption(exactCatalog)
          : null
  const newOption = { kind: 'new', name: displayName(parsed.name), unit: guessUnit(parsed) }
  const candidates = certain || !key ? [] : findCandidates(parsed.name, ingredients, catalog, aliases)

  return {
    ...withQuantity(certain ?? newOption, parsed),
    // 取り込んだときの名前と解析結果(どの食材かを選び直したときに、必要量を計算し直し、別名として覚える)
    sourceName: displayName(parsed.name),
    parsed,
    candidates,
    // 似た食材があって決めきれない: ユーザーが選ぶまで保存しない
    needsChoice: candidates.length > 0,
    // 「適量」「少々」は必要量を決められないので、最初は保存しない
    include: !parsed.vague && Boolean(parsed.name) && !isNotStocked(parsed.name),
  }
}

// どの食材かを選んだとき(候補 / 新しい食材 / ほかの食材)。候補やほかの食材を選んだら、取り込んだ表記を別名として覚える
export function applyChoice(item, option) {
  const parsed = item.parsed ?? { quantity: Number(item.requiredQuantity) || 1, unit: item.unit }
  const target =
    option.kind === 'new'
      ? { kind: 'new', name: item.sourceName ?? item.name, unit: guessUnit(parsed) }
      : option.kind === 'existing'
        ? existingOption(option.ingredient)
        : catalogOption(option.catalogItem)
  const catalogId = option.kind === 'existing' ? option.ingredient.catalog_id : option.kind === 'catalog' ? option.catalogItem.id : null
  const alias = item.sourceName
  const learn = option.kind !== 'new' && alias && catalogId && normalizeName(alias) !== normalizeName(target.name)
  const next = { ...item, ...withQuantity(target, parsed), include: true, needsChoice: false, learnAlias: learn ? { alias, catalogId } : undefined }
  if (option.kind === 'new') delete next.ingredient
  if (option.kind !== 'catalog') delete next.catalogItem
  if (option.kind !== 'existing') delete next.ingredient
  return next
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
