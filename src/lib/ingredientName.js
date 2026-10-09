// 食材名の共通の正規化と名寄せ(レシピの取り込み・材料の追加と編集・冷蔵庫への追加・食材の検索で共通に使う)。
//
// 正規化は「表記の違い」を吸収するだけで、違う食材をまとめるものではない。
// 自動で決める(A)のは、名前が同じ・別名辞書にある・大きさや「新」「国産」などの表記上の修飾を外して一意に一致する場合だけ。
// 状態を表す修飾(冷凍・乾燥・加熱済み など)が付いている、部分一致、候補が複数ある場合は、候補を出してユーザーが選ぶ(B)。
// 似た食材がなければ新しい食材(家庭の食材マスタに登録)にする(C)。数量と単位は食材名とは別に保持し、名前の処理では変えない。

// ---- 1. 表記の統一(全角・半角、空白、かっこ、ひらがな・カタカナ)----
const BRACKETS = /[(（[【<＜〈《「『]([^)）\]】>＞〉》」』]*)[)）\]】>＞〉》」』]/g
// 内側のかっこ(中にかっこを含まない)。入れ子(「トマト（(皮むき)）」)は内側から外す
const INNER_BRACKET = /[(（[【<＜〈《「『]([^(（[【<＜〈《「『)）\]】>＞〉》」』]*)[)）\]】>＞〉》」』]/

// かっこを外した文字列と、かっこの中身の一覧
export function splitBrackets(text) {
  let rest = String(text ?? '')
  const inner = []
  for (let m = rest.match(INNER_BRACKET); m; m = rest.match(INNER_BRACKET)) {
    if (m[1].trim()) inner.push(m[1].trim())
    rest = rest.replace(m[0], ' ')
  }
  // 閉じていないかっこの残り
  rest = rest.replace(/[(（[【<＜〈《「『)）\]】>＞〉》」』]/g, ' ')
  return { rest: rest.replace(/\s+/g, ' ').trim(), inner }
}

export function nameKey(name) {
  return splitBrackets(String(name ?? '').normalize('NFKC'))
    .rest.replace(/[\s・･,、。.:：]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
}

// 画面に出す名前(かっこ書きを外す)
export function displayName(name) {
  const stripped = splitBrackets(name).rest.replace(/[:：]+$/, '').trim()
  return stripped || String(name ?? '').trim()
}

// ---- 2. 修飾語と大きさ ----
// 表記上の修飾(外しても同じ食材として在庫を数えてよい)
const NEUTRAL_PREFIXES = ['国産', '新', '有機', '無農薬', 'お好みの', '好みの', '市販の', '大きめの', '小さめの', '溶き', 'ブロック', '皮付き', '皮つき']
// 下ごしらえ(切り方・用途)の言葉。食材は変わらないので、名前の前後から外して照合する
const PREP_WORDS = [
  'みじん切り', '粗みじん切り', '千切り', 'せん切り', '細切り', '薄切り', '厚切り', '乱切り', '角切り', '輪切り', '半月切り', 'いちょう切り',
  'くし切り', 'ざく切り', '小口切り', 'そぎ切り', '斜め切り', '一口大', 'ひと口大', '刻み', 'ブロック', 'しゃぶしゃぶ用', 'すき焼き用',
  '焼肉用', 'カレー用', 'シチュー用', '炒め物用', '煮物用', '皮むき', '皮をむいたもの', '加熱用', '生',
]
// 状態・加工の言葉は2種類に分ける。
// 属性(ATTRIBUTE_STATES): 食材は同じ。食材マスタへは自動で結び付け、状態はレシピの材料の注記に残す(冷凍えび → エビ・冷凍)
// 別の食材(IDENTITY_STATES): 代用の可否・必要量・味が変わる(干ししいたけ / しいたけ、無塩バター / バター)。
//   元の食材にはまとめず、その名前の食材(なければ家庭の食材マスタに登録)として扱う
export const ATTRIBUTE_STATES = [
  '冷凍', '解凍', '皮なし', 'ダイスカット', 'カット', 'ホール', 'ゆで', '茹で', '蒸し', '加熱済み', '加熱済',
  'すりおろし', 'おろし', '水溶き', '刺身用', '生食用',
]
export const IDENTITY_STATES = ['干し', '乾燥', 'ドライ', '無塩', '有塩', '減塩', '甘塩', '塩漬け', '味付け', '加糖', '無糖', 'チューブ', '缶詰', '水煮', '粉末', '顆粒']
const STATE_WORDS = [...ATTRIBUTE_STATES, ...IDENTITY_STATES]
// 名前の先頭で外して照合するもの。「有塩バター」のように名前そのものが辞書にあれば、外さずにそのまま確定する
const STATE_PREFIXES = [
  '冷凍', '解凍', '乾燥', '干し', 'ドライ', '加熱済み', 'ゆで', '茹で', '蒸し', '水煮', '皮なし', '無塩', '有塩', '減塩', '甘塩',
  'すりおろし', 'おろし', '水溶き', 'ダイスカット', 'カット', 'ホール',
]
// 名前の末尾で外して照合するもの(「にんにくチューブ」)
const STATE_SUFFIXES = ['チューブ', '水煮', '粉末', '顆粒']
// 別の食材として登録するときに、状態の言葉を名前の後ろに付けるもの(「しょうが(チューブ)」→ しょうがチューブ)。それ以外は前に付ける
const SUFFIX_STYLE = new Set(['チューブ', '缶詰', '水煮', '粉末', '顆粒'])
const SIZE_WORDS = ['大きめ', '小さめ', '大', '中', '小', 's', 'm', 'l', 'lサイズ', 'mサイズ', 'sサイズ']

// notes: 材料の行のかっこの中・分量の後ろの言葉(「じゃがいも 1個 冷凍」の「冷凍」)
export function analyzeName(raw, notes = []) {
  const original = String(raw ?? '').trim()
  const nfkc = original.normalize('NFKC')
  const state = [] // 名前の先頭で外した状態の言葉
  const annotState = [] // かっこ・注記にある状態の言葉(名前が一致しても自動では決めない)
  let size = null
  // かっこの中・注記の大きさ・状態(「じゃがいも(中)」「えび(冷凍)」「トマト缶 (ホール)」)。名前の中の空白で区切った言葉も注記とみる
  const { rest, inner: bracketInner } = splitBrackets(nfkc)
  const words = rest.split(/\s+/).filter(Boolean)
  const inner = [...bracketInner, ...words.slice(1), ...notes]
  for (const text of inner) {
    const k = nameKey(text)
    if (SIZE_WORDS.includes(k)) size = k
    for (const w of STATE_WORDS) if (k.includes(nameKey(w))) annotState.push(w)
  }
  const key = nameKey(original)
  // 本体の名前: 空白で区切られていれば最初の言葉(「鶏むね肉 皮付き」→ 鶏むね肉)
  let base = words.length > 1 ? nameKey(words[0]) : key
  const neutral = []
  // 先頭の修飾語(繰り返し外す)。外した残りが2文字以上ある場合だけ
  for (let changed = true; changed; ) {
    changed = false
    for (const w of [...NEUTRAL_PREFIXES, ...STATE_PREFIXES]) {
      const k = nameKey(w)
      // 表記上の修飾は、残りが1文字(「溶き卵」の「卵」)でも外す(照合は登録済みの食材と完全に一致したときだけ)
      const min = STATE_PREFIXES.includes(w) ? 2 : 1
      if (base.startsWith(k) && base.length - k.length >= min) {
        base = base.slice(k.length)
        ;(STATE_PREFIXES.includes(w) ? state : neutral).push(w)
        changed = true
      }
    }
  }
  // 末尾の状態の言葉(「にんにくチューブ」)
  for (const w of STATE_SUFFIXES) {
    const k = nameKey(w)
    if (base.endsWith(k) && base.length - k.length >= 2) {
      base = base.slice(0, -k.length)
      state.push(w)
    }
  }
  // 前後の下ごしらえの言葉(「にんじん細切り」「鶏もも肉一口大」)
  for (const w of PREP_WORDS) {
    const k = nameKey(w)
    if (base.endsWith(k) && base.length - k.length >= 2) {
      base = base.slice(0, -k.length)
      neutral.push(w)
    } else if (base.startsWith(k) && base.length - k.length >= 2) {
      base = base.slice(k.length)
      neutral.push(w)
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
  // 先頭の大きさ(「中じゃがいも」「大玉ねぎ」)は、外した残りが登録済みの食材と一致するときだけ使う(照合側で確かめる)
  const sizePrefix = /^(大|中|小)/.test(base) && base.length >= 3 ? base.slice(1) : null
  // 「すりおろし」と「おろし」のように重なる言葉は、長いほうだけ残す
  const found = [...new Set([...state, ...annotState])]
  const allStates = found.filter((w) => !found.some((o) => o !== w && o.includes(w)))
  return {
    original,
    display: displayName(original),
    key,
    base,
    sizePrefix,
    size,
    neutral,
    state: [...new Set(state)],
    annotState: [...new Set(annotState)],
    attributes: allStates.filter((w) => ATTRIBUTE_STATES.includes(w)),
    identity: allStates.filter((w) => IDENTITY_STATES.includes(w)),
    prep: neutral.filter((w) => PREP_WORDS.includes(w)),
  }
}

// ---- 3. 共通の別名辞書(コード側)----
// DB の共通の別名辞書(ingredient_aliases、migration 013)を補う、語の単位の対応表。正式名は食材マスタの品目名。
// 文字単位の置き換えはしない(「芋」を一律に「いも」にする、のような処理は別の食材を混ぜる恐れがある)
export const COMMON_VARIANTS = {
  じゃがいも: ['ばれいしょ', 'じゃが芋', '馬鈴薯', 'ジャガイモ'],
  玉ねぎ: ['玉葱', 'たまねぎ', 'タマネギ', 'オニオン'],
  にんじん: ['人じん', '人参', 'ニンジン', 'キャロット'],
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
  ナス: ['なすび', 'なす', '茄子'],
  きゅうり: ['胡瓜'],
  かぼちゃ: ['南瓜'],
  ごぼう: ['牛蒡'],
  れんこん: ['蓮根'],
  たけのこ: ['筍', '竹の子'],
  しいたけ: ['椎茸', '生しいたけ'],
  まいたけ: ['舞茸'],
  えのき: ['榎茸', 'えのき茸', 'えのきだけ'],
  しめじ: ['ぶなしめじ'],
  ニラ: ['韮'],
  '大葉(しそ)': ['青紫蘇', 'あおじそ', '大葉', '青じそ', 'しそ', '紫蘇'],
  鶏もも肉: ['鶏もも', '鶏腿肉', 'とりもも肉'],
  鶏むね肉: ['鶏むね', '鶏胸肉', 'とりむね肉'],
  鶏ひき肉: ['鶏挽き肉', '鶏挽肉', '鶏ミンチ'],
  豚ひき肉: ['豚挽き肉', '豚挽肉', '豚ミンチ'],
  牛ひき肉: ['牛挽き肉', '牛挽肉', '牛ミンチ'],
  合いびき肉: ['合挽き肉', '合い挽き肉', '合挽肉', '合びき肉', 'あいびき肉'],
  豚こま切れ肉: ['豚小間肉', '豚こま肉', '豚小間切れ肉', '豚こま', '豚細切れ肉'],
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
  砂糖: ['さとう', 'お砂糖', '上白糖'],
  料理酒: ['料理用酒', '酒', '日本酒'],
  こしょう: ['胡椒'],
  塩: ['食塩'],
  酢: ['米酢', 'お酢'],
  みりん: ['本みりん', '味醂'],
  白ごま: ['白胡麻', 'しろごま', 'いりごま', '白いりごま', '炒りごま'],
  '削り節(かつお節)': ['かつお節', 'かつおぶし', '鰹節'],
  片栗粉: ['かたくり粉'],
  小麦粉: ['こむぎ粉', '薄力粉'],
  スパゲッティ: ['スパゲティ', 'パスタ'],
  中華麺: ['中華めん'],
  ケチャップ: ['トマトケチャップ'],
  顆粒コンソメ: ['コンソメ', 'コンソメ顆粒'],
  鶏がらスープの素: ['鶏ガラスープの素'],
  ウインナー: ['ウィンナー', 'ウインナーソーセージ'],
  ピザ用チーズ: ['とろけるチーズ'],
  ごま油: ['胡麻油', 'ゴマ油'],
  オリーブオイル: ['オリーブ油'],
  レモン: ['檸檬'],
  りんご: ['林檎'],
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
export function findCandidates(rawName, index, limit = 4, notes = []) {
  const a = analyzeName(rawName, notes)
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

// 別の食材として登録するときの名前(「バター(無塩)」→ 無塩バター、「しょうが(チューブ)」→ しょうがチューブ)
function identityName(a) {
  const body = a.display.split(/\s+/)[0]
  const missing = a.identity.filter((w) => !nameKey(body).includes(nameKey(w)))
  const prefix = missing.filter((w) => !SUFFIX_STYLE.has(w)).join('')
  const suffix = missing.filter((w) => SUFFIX_STYLE.has(w)).join('')
  return `${prefix}${body}${suffix}`
}

// 食材名を照合する。
// status: 'auto'(食材マスタ・冷蔵庫の食材に自動で確定)/ 'new'(家庭の食材マスタに新しく登録する)/ 'choose'(候補から選ぶ。保存は妨げない)
// note: 材料の注記に残す状態・下ごしらえ(冷凍・皮なし・一口大 など)。newName: 'new' のときに登録する名前
export function matchIngredientName(rawName, index, { notes = [] } = {}) {
  const a = analyzeName(rawName, notes)
  const note = [...a.attributes, ...a.prep].join('・') || null
  if (!a.key) return { status: 'new', option: null, candidates: [], analysis: a, note, newName: a.display }
  const hasIdentity = a.identity.length > 0
  // 別の食材(干ししいたけ・無塩バター・にんにくチューブ): その名前で確定(なければ家庭の食材として登録)。元の食材にはまとめない
  if (hasIdentity) {
    const name = identityName(a)
    const hit = exactLookup(index, nameKey(name)) ?? (a.annotState.length === 0 ? exactLookup(index, a.key) : null)
    if (hit) return { status: 'auto', option: hit.option, via: hit.via, candidates: [], analysis: a, note }
    return { status: 'new', option: null, candidates: [], analysis: a, note, newName: name }
  }
  // そのままの名前(家庭の別名・冷蔵庫・食材マスタ・共通の別名)。属性の状態は注記に残す
  const exact = exactLookup(index, a.key)
  if (exact) return { status: 'auto', option: exact.option, via: exact.via, candidates: [], analysis: a, note }
  // 大きさ・表記上の修飾・下ごしらえ・属性の状態を外して一意に一致
  const base = (a.base !== a.key ? exactLookup(index, a.base) : null) ?? (a.sizePrefix ? exactLookup(index, a.sizePrefix) : null)
  if (base) return { status: 'auto', option: base.option, via: 'base', candidates: [], analysis: a, note }
  // 部分一致・候補が複数: 決めずに候補を出す(レシピは保存でき、あとで選べる)
  const candidates = findCandidates(rawName, index, 4, notes)
  if (candidates.length > 0) return { status: 'choose', option: null, candidates, reason: 'similar', analysis: a, note }
  // 似た食材がない: 家庭の食材として登録する
  return { status: 'new', option: null, candidates: [], analysis: a, note, newName: a.display.split(/\s+/)[0] }
}

// 食材の検索(cmdk)で、別名や表記の違いからも見つかるようにするキーワード
export function searchKeywords(catalogItem, index) {
  return [nameKey(catalogItem.name), ...(index.aliasWords.get(catalogItem.id) ?? [])]
}
