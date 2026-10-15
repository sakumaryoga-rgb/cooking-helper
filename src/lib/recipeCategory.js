// レシピの料理カテゴリ(1レシピに1つ)。並び順はレシピ一覧のまとまりの順。
// カテゴリを増やすときは、ここに足すだけでよい(DB は形だけを確かめる。migration 028)
export const CATEGORIES = [
  { id: 'japanese', label: '和食', emoji: '🍙' },
  { id: 'chinese', label: '中華', emoji: '🥟' },
  { id: 'italian', label: 'イタリアン', emoji: '🍝' },
  { id: 'western', label: '洋食', emoji: '🍳' },
  { id: 'korean', label: '韓国料理', emoji: '🌶️' },
  { id: 'ethnic', label: 'エスニック', emoji: '🍛' },
  { id: 'other', label: 'その他・未分類', emoji: '🍽️' },
]

export const OTHER = 'other'
const KNOWN = new Set(CATEGORIES.map((c) => c.id))

export function categoryInfo(id) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES.find((c) => c.id === OTHER)
}

// 料理名の手がかり(強い)。料理名に含まれていれば、そのジャンルとみなせる言葉だけを入れる
// (サイトのドメインでは決めない。どのサイトにもいろいろなジャンルがあるため)
const TITLE_RULES = {
  japanese: [
    '和風', '和食', '味噌汁', 'みそ汁', '豚汁', 'けんちん汁', 'お吸い物', '肉じゃが', '筑前煮', '煮物', '煮付け', '煮つけ', '照り焼き', '照焼', 'てりやき',
    '生姜焼き', 'しょうが焼き', '親子丼', '牛丼', 'カツ丼', 'かつ丼', '天丼', '天ぷら', '天麩羅', 'すき焼き', 'しゃぶしゃぶ', 'おひたし', 'お浸し', '煮浸し', '白和え',
    'ごま和え', '胡麻和え', 'きんぴら', '茶碗蒸し', '卵焼き', '玉子焼き', 'だし巻き', '炊き込みご飯', '混ぜご飯', 'おにぎり', 'お茶漬け', '雑炊', 'うどん', 'そば',
    '蕎麦', 'そうめん', '素麺', '寿司', 'ちらし', '手巻き', 'おでん', '湯豆腐', '肉豆腐', '揚げ出し', '唐揚げ', 'から揚げ', '竜田揚げ', '南蛮漬け', 'チキン南蛮',
    '西京焼き', '塩焼き', '蒲焼', 'かば焼き', 'ぶり大根', '鯖の味噌煮', 'さばの味噌煮', '角煮', 'ひじき', '切り干し', '酢の物', '浅漬け', 'お好み焼き', 'たこ焼き',
    '焼きそば', '焼きうどん', 'ちゃんこ', '鍋焼き', '卵かけご飯', '田楽', '佃煮', '甘酢', '甘辛',
  ],
  chinese: [
    '中華', '麻婆', 'マーボー', '回鍋肉', 'ホイコーロー', '青椒肉絲', 'チンジャオロース', '酢豚', 'エビチリ', '海老チリ', 'エビマヨ', 'チャーハン', '炒飯',
    '餃子', 'ギョーザ', '焼売', 'シュウマイ', 'シューマイ', '春巻', '八宝菜', '中華丼', '天津飯', '担々', '坦々', '棒棒鶏', 'バンバンジー', '油淋鶏', 'ユーリンチー',
    '回鍋', '麻辣', '小籠包', '杏仁', 'ラーメン', '酸辣湯', 'サンラータン', '中華スープ', '春雨サラダ', 'よだれ鶏', '空心菜', 'チンゲン菜炒め', '豆苗炒め',
  ],
  italian: [
    'イタリアン', 'パスタ', 'スパゲッティ', 'スパゲティ', 'ペペロンチーノ', 'カルボナーラ', 'ボロネーゼ', 'ナポリタン', 'ペスカトーレ', 'ジェノベーゼ',
    'アラビアータ', 'ラザニア', 'リゾット', 'ピザ', 'ピッツァ', 'ニョッキ', 'カルパッチョ', 'アクアパッツァ', 'ミネストローネ', 'ブルスケッタ', 'カプレーゼ',
    'アヒージョ', 'ペンネ', 'フェットチーネ', 'マカロニ', 'ティラミス', 'パンナコッタ', 'バーニャカウダ',
  ],
  western: [
    '洋風', 'ハンバーグ', 'グラタン', 'ドリア', 'シチュー', 'ポトフ', 'オムライス', 'オムレツ', 'コロッケ', 'クリーム煮', 'ムニエル', 'ステーキ', 'ロールキャベツ',
    'ポテトサラダ', 'ポテサラ', 'コールスロー', 'マリネ', 'ソテー', 'ピカタ', 'フリカッセ', 'ビーフストロガノフ', 'ハヤシ', 'エビフライ', 'カツレツ', 'メンチカツ',
    'ミートローフ', 'ローストビーフ', 'ローストポーク', 'ローストチキン', 'ポタージュ', 'クラムチャウダー', 'コンソメスープ', 'サンドイッチ', 'サンド', 'トースト',
    'キッシュ', 'パンケーキ', 'フレンチトースト', 'カレーライス', 'ハッシュドビーフ', 'ミートボール',
  ],
  korean: [
    '韓国', 'キムチ', 'ビビンバ', 'チヂミ', 'プルコギ', 'ナムル', 'トッポギ', 'トッポッキ', 'スンドゥブ', 'チャプチェ', 'サムギョプサル', 'ヤンニョム', 'チゲ',
    'ケランチム', 'クッパ', 'キンパ', 'タッカルビ', 'チーズダッカルビ', 'ダッカルビ', 'カクテキ', 'サムゲタン', 'ポッサム', 'コチュジャン',
  ],
  ethnic: [
    'エスニック', 'タイ風', 'ベトナム', 'インド', 'ガパオ', 'トムヤム', 'グリーンカレー', 'レッドカレー', 'マッサマン', 'パッタイ', 'カオマンガイ', 'フォー',
    '生春巻き', 'バインミー', 'ナシゴレン', 'ミーゴレン', 'タンドリー', 'ビリヤニ', 'サモサ', 'タコス', 'タコライス', 'ブリトー', 'ケバブ', 'ルーロー飯', 'ルーローハン',
    'サテ', 'ラープ', 'ソムタム', 'キーマカレー', 'バターチキン', 'スパイスカレー', 'メキシカン', 'ファヒータ',
  ],
}

// 材料の手がかり(弱い)。そのジャンルらしい調味料・食材
const INGREDIENT_RULES = {
  japanese: ['みりん', '味噌', 'みそ', 'だし', 'ほんだし', '和風顆粒だし', 'めんつゆ', '昆布', 'かつお節', '鰹節', '白だし', '酒粕', '大葉', 'みょうが', '油揚げ'],
  chinese: ['豆板醤', '甜麺醤', 'オイスターソース', '鶏ガラ', '鶏がらスープ', '紹興酒', '花椒', 'XO醤', '中華だし', 'ウェイパー', '豆鼓', '腐乳', '八角'],
  italian: ['オリーブオイル', 'パルメザン', 'パルミジャーノ', 'バジル', 'モッツァレラ', 'アンチョビ', 'パンチェッタ', 'スパゲッティ', 'ペンネ', 'トマト缶', 'カットトマト', 'オレガノ', 'ケッパー'],
  western: ['バター', '生クリーム', 'コンソメ', 'デミグラス', 'ホワイトソース', 'ケチャップ', 'ウスターソース', 'ローリエ', 'ナツメグ', 'チーズ', '牛乳'],
  korean: ['コチュジャン', 'キムチ', '韓国のり', '韓国海苔', 'ダシダ', '粉唐辛子', 'トック', 'ごま油'],
  ethnic: ['ナンプラー', 'パクチー', 'ココナッツミルク', 'レモングラス', 'スイートチリ', 'クミン', 'ガラムマサラ', 'ターメリック', 'コリアンダー', 'カレー粉', 'ライム', 'チリパウダー'],
}

// 構造化データ(recipeCuisine / recipeCategory / keywords)の表記
const CUISINE_WORDS = {
  japanese: ['和食', '和風', 'japanese', 'japan', '日本'],
  chinese: ['中華', '中国', 'chinese', 'china'],
  italian: ['イタリアン', 'イタリア', 'italian', 'italy'],
  western: ['洋食', '洋風', 'western', 'french', 'フレンチ', 'american', 'アメリカ'],
  korean: ['韓国', 'korean', 'korea'],
  ethnic: ['エスニック', 'タイ', 'ベトナム', 'インド', 'メキシコ', 'thai', 'vietnamese', 'indian', 'mexican', 'ethnic', 'asian'],
}

function normalize(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase()
}

function includesAny(text, words) {
  return words.filter((w) => text.includes(normalize(w)))
}

// 料理名・材料・構造化データから、明らかなときだけカテゴリを返す。分からなければ 'other'
// recipe: { title, ingredientNames?: string[], cuisine?: string[], categories?: string[], keywords?: string[] }
export function classifyRecipe({ title = '', ingredientNames = [], cuisine = [], categories = [], keywords = [] } = {}) {
  const t = normalize(title)
  const meta = normalize([...cuisine, ...categories, ...keywords].join(' '))
  const names = ingredientNames.map(normalize)
  const score = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]))

  // 構造化データの料理ジャンル(サイトが付けたもの)は最も強い手がかり
  for (const [id, words] of Object.entries(CUISINE_WORDS)) {
    if (includesAny(normalize(cuisine.join(' ')), words).length) score[id] += 6
    else if (includesAny(meta, words).length) score[id] += 3
  }
  for (const [id, words] of Object.entries(TITLE_RULES)) {
    if (includesAny(t, words).length) score[id] += 5
  }
  for (const [id, words] of Object.entries(INGREDIENT_RULES)) {
    const hits = new Set(names.filter((n) => words.some((w) => n.includes(normalize(w)))))
    score[id] += Math.min(hits.size, 3)
  }

  const ranked = Object.entries(score)
    .filter(([id]) => id !== OTHER)
    .sort((a, b) => b[1] - a[1])
  const [best, second] = ranked
  // 料理名か構造化データの手がかりがある(5点以上)、または材料の手がかりだけでも3点以上で、
  // 2番目と2点以上の差があるときだけ分類する。曖昧なら「その他・未分類」
  if (best[1] >= 3 && best[1] - (second?.[1] ?? 0) >= 2) return best[0]
  return OTHER
}

// レシピの材料の名前(冷蔵庫の食材・確認待ちの名前)
export function ingredientNamesOf(recipe) {
  return (recipe?.recipe_ingredients ?? []).map((ri) => ri.ingredient?.name ?? ri.source_name ?? '').filter(Boolean)
}

// 表示するカテゴリ。利用者が選んだもの > 保存した自動の分類 > 今の料理名と材料からの分類(既存のレシピ)
export function categoryOf(recipe) {
  if (!recipe) return OTHER
  if (recipe.category && KNOWN.has(recipe.category)) return recipe.category
  if (recipe.category_manual) return OTHER
  return classifyRecipe({ title: recipe.title, ingredientNames: ingredientNamesOf(recipe) })
}
