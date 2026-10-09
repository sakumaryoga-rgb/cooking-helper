// 食材名の共通の正規化と名寄せ(レシピの取り込み・材料の追加と編集・冷蔵庫への追加・食材の検索で共通に使う)。
//
// 正規化は「表記の違い」を吸収するだけで、違う食材をまとめるものではない。
// 自動で決める(A)のは、名前が同じ・別名辞書にある・大きさや「新」「国産」などの表記上の修飾を外して一意に一致する場合だけ。
// 状態を表す修飾(冷凍・乾燥・加熱済み など)が付いている、部分一致、候補が複数ある場合は、候補を出してユーザーが選ぶ(B)。
// 似た食材がなければ新しい食材(家庭の食材マスタに登録)にする(C)。数量と単位は食材名とは別に保持し、名前の処理では変えない。

// ---- 1. 表記の統一(全角・半角、空白、かっこ、ひらがな・カタカナ)----
const BRACKETS = /[(（[【<＜〈《「『]([^)）\]】>＞〉》」』]*)[)）\]】>＞〉》」』]/g

export function nameKey(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(BRACKETS, '')
    .replace(/[\s・･,、。.]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
}

// 画面に出す名前(かっこ書きを外す)
export function displayName(name) {
  const stripped = String(name ?? '').replace(BRACKETS, '').trim()
  return stripped || String(name ?? '').trim()
}

// ---- 2. 修飾語と大きさ ----
// 表記上の修飾(外しても同じ食材として在庫を数えてよい)
const NEUTRAL_PREFIXES = ['国産', '新', '有機', '無農薬', 'お好みの', '好みの', '市販の', '皮付き', '皮つき', '大きめの', '小さめの']
// 状態を表す修飾(保存方法や用途が変わる。照合には使うが、決めるのはユーザー)
const STATE_WORDS = ['冷凍', '乾燥', '干し', '加熱済み', '加熱済', 'ゆで', '茹で', '蒸し', '解凍', '缶詰', '水煮']
const SIZE_WORDS = ['大きめ', '小さめ', '大', '中', '小', 's', 'm', 'l', 'lサイズ', 'mサイズ', 'sサイズ']

export function analyzeName(raw) {
  const original = String(raw ?? '').trim()
  const nfkc = original.normalize('NFKC')
  const state = []
  let size = null
  // かっこの中の大きさ・状態(「じゃがいも(中)」「えび(冷凍)」)
  for (const m of nfkc.matchAll(BRACKETS)) {
    const inner = nameKey(m[1])
    if (SIZE_WORDS.includes(inner)) size = inner
    for (const w of STATE_WORDS) if (inner.includes(nameKey(w))) state.push(w)
  }
  const key = nameKey(original)
  let base = key
  const neutral = []
  // 先頭の修飾語(繰り返し外す)。外した残りが2文字以上ある場合だけ
  for (let changed = true; changed; ) {
    changed = false
    for (const w of [...NEUTRAL_PREFIXES, ...STATE_WORDS]) {
      const k = nameKey(w)
      if (base.startsWith(k) && base.length - k.length >= 2) {
        base = base.slice(k.length)
        ;(STATE_WORDS.includes(w) ? state : neutral).push(w)
        changed = true
      }
    }
  }
  // 末尾の大きさ(「じゃがいも中」)
  for (const w of SIZE_WORDS) {
    if (base.endsWith(w) && base.length - w.length >= 2) {
      size = size ?? w
      base = base.slice(0, -w.length)
      break
    }
  }
  return { original, display: displayName(original), key, base, size, neutral, state: [...new Set(state)] }
}

// ---- 3. 共通の別名辞書(コード側)----
// DB の共通の別名辞書(ingredient_aliases、migration 013)を補う、語の単位の対応表。正式名は食材マスタの品目名。
// 文字単位の置き換えはしない(「芋」を一律に「いも」にする、のような処理は別の食材を混ぜる恐れがある)
export const COMMON_VARIANTS = {
  じゃがいも: ['じゃが芋', '馬鈴薯', 'ジャガイモ'],
  玉ねぎ: ['玉葱', 'たまねぎ', 'タマネギ', 'オニオン'],
  にんじん: ['人参', 'ニンジン', 'キャロット'],
  長ねぎ: ['長葱', '長ネギ', '白ねぎ', '白ネギ', '根深ねぎ'],
  '万能ねぎ(小ねぎ)': ['小ねぎ', '小葱', '青ねぎ', '細ねぎ', '万能ねぎ', '万能葱'],
  さつまいも: ['さつま芋', '薩摩芋', 'サツマイモ'],
  里いも: ['里芋', 'さといも'],
  長いも: ['長芋', 'ながいも'],
  しょうが: ['生姜', 'ショウガ'],
  にんにく: ['大蒜', 'ニンニク', 'ガーリック'],
  大根: ['だいこん'],
  白菜: ['はくさい'],
  ほうれん草: ['ほうれんそう', '法蓮草'],
  小松菜: ['こまつな'],
  ナス: ['なす', '茄子'],
  きゅうり: ['胡瓜'],
  かぼちゃ: ['南瓜'],
  ごぼう: ['牛蒡'],
  れんこん: ['蓮根'],
  たけのこ: ['筍', '竹の子'],
  しいたけ: ['椎茸', '生しいたけ'],
  まいたけ: ['舞茸'],
  えのき: ['えのき茸', 'えのきだけ'],
  しめじ: ['ぶなしめじ'],
  ニラ: ['韮'],
  '大葉(しそ)': ['大葉', '青じそ', 'しそ', '紫蘇'],
  鶏もも肉: ['鶏もも', '鶏腿肉', 'とりもも肉'],
  鶏むね肉: ['鶏むね', '鶏胸肉', 'とりむね肉'],
  鶏ひき肉: ['鶏挽き肉', '鶏挽肉', '鶏ミンチ'],
  豚ひき肉: ['豚挽き肉', '豚挽肉', '豚ミンチ'],
  牛ひき肉: ['牛挽き肉', '牛挽肉', '牛ミンチ'],
  合いびき肉: ['合挽き肉', '合い挽き肉', '合挽肉', '合びき肉', 'あいびき肉'],
  豚こま切れ肉: ['豚こま肉', '豚小間切れ肉', '豚こま', '豚細切れ肉'],
  牛こま切れ肉: ['牛こま肉', '牛小間切れ肉', '牛こま'],
  豚バラ肉: ['豚ばら肉', '豚バラ', '豚バラ薄切り肉'],
  '鮭(切り身)': ['鮭', 'さけ', '生鮭'],
  'サバ(切り身)': ['鯖', 'さば'],
  'ブリ(切り身)': ['鰤', 'ぶり'],
  'タラ(切り身)': ['鱈', 'たら', '生たら'],
  エビ: ['海老'],
  イカ: ['烏賊'],
  タコ: ['蛸'],
  ホタテ: ['帆立'],
  アサリ: ['浅蜊'],
  シジミ: ['蜆'],
  卵: ['玉子', 'たまご', '鶏卵'],
  牛乳: ['ミルク'],
  バター: ['有塩バター'],
  木綿豆腐: ['もめん豆腐'],
  絹豆腐: ['絹ごし豆腐'],
  油揚げ: ['油あげ', '薄揚げ'],
  醤油: ['しょうゆ', 'しょう油', '濃口醤油', '濃口しょうゆ'],
  味噌: ['みそ', '合わせ味噌'],
  砂糖: ['上白糖'],
  料理酒: ['酒', '日本酒'],
  こしょう: ['胡椒'],
  塩: ['食塩'],
  酢: ['米酢', 'お酢'],
  みりん: ['本みりん', '味醂'],
  白ごま: ['いりごま', '白いりごま', '炒りごま'],
  '削り節(かつお節)': ['かつお節', 'かつおぶし', '鰹節'],
  片栗粉: ['かたくり粉'],
  小麦粉: ['薄力粉'],
  スパゲッティ: ['スパゲティ', 'パスタ'],
  中華麺: ['中華めん'],
  ケチャップ: ['トマトケチャップ'],
  顆粒コンソメ: ['コンソメ', 'コンソメ顆粒'],
  鶏がらスープの素: ['鶏ガラスープの素'],
  ウインナー: ['ウィンナー', 'ウインナーソーセージ'],
  ピザ用チーズ: ['とろけるチーズ'],
}

// ---- 4. 照合 ----
function existingOption(ingredient) {
  return { kind: 'existing', ingredient, name: ingredient.name, unit: ingredient.unit }
}

function catalogOption(catalogItem) {
  return { kind: 'catalog', catalogItem, name: catalogItem.name, unit: catalogItem.unit }
}

// 照合に使う索引(冷蔵庫の行・食材マスタ・別名)。家庭の別名(group_id あり)を共通の別名より優先する
export function buildNameIndex({ ingredients = [], catalog = [], aliases = [] }) {
  // 同じ名前の品目が共通と家庭の両方にあれば、家庭のものを使う
  const catalogByKey = new Map()
  for (const c of catalog) {
    const k = nameKey(c.name)
    const prev = catalogByKey.get(k)
    if (!prev || (c.group_id && !prev.group_id)) catalogByKey.set(k, c)
  }
  const catalogById = new Map(catalog.map((c) => [c.id, c]))
  const ownAlias = new Map()
  const commonAlias = new Map()
  const aliasWords = new Map() // 品目 ID → 別名(検索のキーワード用。元の書き方のまま)
  const addWord = (item, word) => {
    if (!aliasWords.has(item.id)) aliasWords.set(item.id, [])
    aliasWords.get(item.id).push(word)
  }
  for (const a of aliases) {
    const item = catalogById.get(a.catalog_id)
    if (!item) continue
    ;(a.group_id ? ownAlias : commonAlias).set(nameKey(a.alias), item)
    addWord(item, a.alias)
  }
  for (const [canonical, variants] of Object.entries(COMMON_VARIANTS)) {
    const item = catalogByKey.get(nameKey(canonical))
    if (!item) continue
    for (const v of variants) {
      if (!commonAlias.has(nameKey(v))) commonAlias.set(nameKey(v), item)
      addWord(item, v)
    }
  }
  const fridgeByKey = new Map()
  const fridgeByCatalog = new Map()
  for (const i of ingredients) {
    fridgeByKey.set(nameKey(i.name), i)
    if (i.catalog_id) fridgeByCatalog.set(i.catalog_id, i)
  }
  return { ingredients, catalog, catalogByKey, ownAlias, commonAlias, aliasWords, fridgeByKey, fridgeByCatalog }
}

// 食材マスタの品目を、冷蔵庫にあればその行に置き換える(同じ食材を二重に作らない)
function toOption(index, catalogItem) {
  const row = index.fridgeByCatalog.get(catalogItem.id) ?? index.fridgeByKey.get(nameKey(catalogItem.name))
  return row ? existingOption(row) : catalogOption(catalogItem)
}

// キー1つで、迷わず決められる食材を探す(家庭の別名 → 冷蔵庫 → 食材マスタ → 共通の別名)
function exactLookup(index, key) {
  if (!key) return null
  const own = index.ownAlias.get(key)
  if (own) return { option: toOption(index, own), via: 'household-alias' }
  const fridge = index.fridgeByKey.get(key)
  if (fridge) return { option: existingOption(fridge), via: 'name' }
  const item = index.catalogByKey.get(key)
  if (item) return { option: toOption(index, item), via: 'name' }
  const common = index.commonAlias.get(key)
  if (common) return { option: toOption(index, common), via: 'alias' }
  return null
}

const optionId = (o) => (o.kind === 'existing' ? `i:${o.ingredient.id}` : o.kind === 'catalog' ? `c:${o.catalogItem.id}` : 'new')

// 候補(部分一致・類似)。近い順に最大 limit 件。候補の表示だけに使い、自動では決めない
export function findCandidates(rawName, index, limit = 4) {
  const a = analyzeName(rawName)
  if (!a.key) return []
  const scored = new Map()
  const add = (option, score) => {
    const id = optionId(option)
    if (!scored.has(id) || scored.get(id).score > score) scored.set(id, { option, score })
  }
  const base = exactLookup(index, a.base)
  if (base && a.base !== a.key) add(base.option, 0)
  const score = (name) => {
    const n = nameKey(name)
    if (n.length < 2) return 0
    if (a.key.endsWith(n) || a.base.endsWith(n)) return 1
    if (n.endsWith(a.base) || n.startsWith(a.base) || a.base.startsWith(n)) return 2
    if (n.includes(a.base) || a.base.includes(n)) return 3
    return 0
  }
  for (const i of index.ingredients) {
    const s = score(i.name)
    if (s) add(existingOption(i), s)
  }
  for (const c of index.catalog) {
    const s = score(c.name)
    if (s) add(toOption(index, c), s)
  }
  for (const [aliasKey, item] of [...index.commonAlias, ...index.ownAlias]) {
    const s = score(aliasKey)
    if (s) add(toOption(index, item), s + 0.5)
  }
  return [...scored.values()]
    .sort((x, y) => x.score - y.score || x.option.name.length - y.option.name.length)
    .slice(0, limit)
    .map((x) => x.option)
}

// 食材名を照合する。status: 'auto'(A: 自動で確定)/ 'choose'(B: 候補から選ぶ)/ 'new'(C: 新しい食材)
export function matchIngredientName(rawName, index) {
  const a = analyzeName(rawName)
  if (!a.key) return { status: 'new', option: null, candidates: [], analysis: a }
  // A-1: そのままの名前(家庭の別名・冷蔵庫・食材マスタ・共通の別名)
  const exact = exactLookup(index, a.key)
  if (exact && a.state.length === 0) return { status: 'auto', option: exact.option, via: exact.via, candidates: [], analysis: a }
  // A-2: 大きさ・表記上の修飾だけを外して一意に一致(状態の修飾があれば B)
  const base = a.base !== a.key ? exactLookup(index, a.base) : null
  if (base && a.state.length === 0) return { status: 'auto', option: base.option, via: 'base', candidates: [], analysis: a }
  // B: 候補を出して選んでもらう
  const candidates = findCandidates(rawName, index)
  if (exact && !candidates.some((c) => optionId(c) === optionId(exact.option))) candidates.unshift(exact.option)
  if (candidates.length > 0) {
    return { status: 'choose', option: null, candidates, reason: a.state.length ? 'state' : 'similar', analysis: a }
  }
  // C: 似た食材がない
  return { status: 'new', option: null, candidates: [], analysis: a }
}

// 食材の検索(cmdk)で、別名や表記の違いからも見つかるようにするキーワード
export function searchKeywords(catalogItem, index) {
  return [nameKey(catalogItem.name), ...(index.aliasWords.get(catalogItem.id) ?? [])]
}
