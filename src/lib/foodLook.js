// 画面の見た目(絵文字と色)だけに使う。データの判定には使わない

const CATEGORY_LOOK = [
  [/肉/, '🍖', 'bg-rose-100'],
  [/魚|魚介/, '🐟', 'bg-sky-100'],
  [/卵|乳/, '🥚', 'bg-amber-100'],
  [/大豆|豆腐/, '🫘', 'bg-lime-100'],
  [/きのこ|キノコ/, '🍄', 'bg-orange-100'],
  [/根菜/, '🥕', 'bg-orange-100'],
  [/果菜/, '🍅', 'bg-red-100'],
  [/葉茎|葉物|野菜/, '🥬', 'bg-emerald-100'],
  [/果物/, '🍎', 'bg-pink-100'],
  [/穀物|麺|パン|米/, '🍚', 'bg-yellow-100'],
  [/調味料|油/, '🧂', 'bg-stone-200'],
]

// 食材名で、カテゴリより細かい絵を選ぶ
const NAME_LOOK = [
  [/牛乳|ミルク/, '🥛'],
  [/チーズ/, '🧀'],
  [/バター/, '🧈'],
  [/ヨーグルト/, '🥛'],
  [/豆腐|納豆/, '🫘'],
  [/鶏|チキン/, '🍗'],
  [/ベーコン/, '🥓'],
  [/海老|えび|エビ/, '🦐'],
  [/いか|イカ|たこ|タコ/, '🦑'],
  [/玉ねぎ|たまねぎ|玉葱/, '🧅'],
  [/じゃがいも|ジャガイモ|さつまいも/, '🥔'],
  [/にんにく|ニンニク/, '🧄'],
  [/きゅうり|キュウリ/, '🥒'],
  [/なす|ナス/, '🍆'],
  [/ピーマン|パプリカ/, '🫑'],
  [/とうもろこし|コーン/, '🌽'],
  [/ブロッコリー/, '🥦'],
  [/レモン/, '🍋'],
  [/バナナ/, '🍌'],
  [/パン/, '🍞'],
  [/麺|うどん|そば|パスタ|スパゲッティ/, '🍝'],
]

export function categoryLook(category, name = '') {
  const named = NAME_LOOK.find(([re]) => re.test(name ?? ''))
  for (const [re, emoji, bg] of CATEGORY_LOOK) if (re.test(category ?? '')) return { emoji: named ? named[1] : emoji, bg }
  if (named) return { emoji: named[1], bg: 'bg-muted' }
  return { emoji: '🥫', bg: 'bg-muted' }
}

// 料理名から器の絵柄を選ぶ(当たらなければお皿)
const DISH_LOOK = [
  [/カレー/, '🍛'],
  [/卵|たまご|玉子|オム|目玉|親子/, '🍳'],
  [/ラーメン|うどん|そば|麺|焼きそば|そうめん/, '🍜'],
  [/パスタ|スパゲ|ナポリタン|グラタン|マカロニ/, '🍝'],
  [/丼|ご飯|ごはん|炒飯|チャーハン|おにぎり|ライス|雑炊|リゾット/, '🍚'],
  [/寿司|すし|刺身/, '🍣'],
  [/サラダ|和え|おひたし|ナムル/, '🥗'],
  [/スープ|汁|鍋|シチュー|ポトフ|煮込み|ミネストローネ|ポタージュ/, '🍲'],
  [/魚|鮭|さば|サバ|ぶり|あじ|いわし|焼き魚/, '🐟'],
  [/唐揚げ|からあげ|フライ|天ぷら|カツ|揚げ/, '🍤'],
  [/ハンバーグ|ステーキ|肉|生姜焼き|焼肉|チキン/, '🍖'],
  [/パン|トースト|サンド/, '🥪'],
  [/ケーキ|クッキー|プリン|ゼリー|デザート|おやつ/, '🍰'],
  [/餃子|ぎょうざ|シュウマイ|春巻/, '🥟'],
  [/お好み焼き|たこ焼き|ピザ/, '🍕'],
]

const PLATES = ['bg-amber-100', 'bg-rose-100', 'bg-sky-100', 'bg-emerald-100', 'bg-violet-100', 'bg-orange-100']

export function dishLook(recipe) {
  const title = recipe?.title ?? ''
  // 自分で選んだ絵があればそれを使う
  const found = recipe?.icon ? [null, recipe.icon] : DISH_LOOK.find(([re]) => re.test(title))
  let h = 0
  for (const ch of String(recipe?.id ?? title)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { emoji: found ? found[1] : '🍽️', bg: PLATES[h % PLATES.length] }
}

// 時間帯のあいさつ
export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 5) return { text: 'こんばんは', sub: '夜食はほどほどに' }
  if (h < 11) return { text: 'おはようございます', sub: '朝ごはん、なににしよう?' }
  if (h < 15) return { text: 'こんにちは', sub: 'お昼ごはん、なににしよう?' }
  if (h < 18) return { text: 'こんにちは', sub: '晩ごはんの準備、はじめますか?' }
  return { text: 'こんばんは', sub: '晩ごはん、なににしよう?' }
}
