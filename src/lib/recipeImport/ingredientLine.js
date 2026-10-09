// 「鶏むね肉 1枚(250g)」「S&B 本鶏だし 1パック」「塩 少々」のような材料の1行を、
// 食材名と分量と注記に分ける。分量は数値と単位に読めた場合だけ quantity / unit を入れる。
// 元の表記は raw に残す。数量・単位は推測で補わない(幅・複数の食材に共通の分量などは、画面で確かめてもらう)

const VAGUE = ['適量', '少々', '適宜', 'お好みで', '好みで', 'ひとつまみ', '少量', 'たっぷり']
const SPOON = { 大さじ: 15, 小さじ: 5, カップ: 200 } // ml
const SHARED = '(?:各|それぞれ)'
const AMOUNT_START = new RegExp(`^(?:${SHARED}|約)*(?:[0-9.\\/½¼¾⅓⅔]|大さじ|小さじ|カップ|${VAGUE.join('|')})`)
const BRACKET = /[(（[【<＜〈《]([^)）\]】>＞〉》]*)[)）\]】>＞〉》]/g

function toHalfWidth(text) {
  // 「200ɡ」(ラテン文字の ɡ)も g とみなす
  return String(text).normalize('NFKC').replace(/ɡ/g, 'g')
}

function parseNumber(text) {
  const t = text.replace(/½/g, '1/2').replace(/¼/g, '1/4').replace(/¾/g, '3/4').replace(/⅓/g, '1/3').replace(/⅔/g, '2/3')
  // 「1と1/2」
  let m = t.match(/^(\d+)と(\d+)\/(\d+)/)
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3])
  m = t.match(/^(\d+)\/(\d+)/)
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null
  m = t.match(/^(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

// 分量の文字列を読む。range: 「150〜200g」の幅、approx: 「約」、shared: 「各」「それぞれ」(複数の食材に同じ分量)
export function parseAmount(amountText) {
  const raw = toHalfWidth(amountText).replace(/\s+/g, '')
  const shared = new RegExp(`^${SHARED}`).test(raw)
  const text = raw.replace(new RegExp(`^(?:${SHARED}|約)+`), '')
  const result = { quantity: null, unit: null, grams: null, ml: null, vague: false, range: null, approx: /約/.test(raw), shared }
  if (!text) return result
  if (VAGUE.some((v) => text.startsWith(v))) return { ...result, vague: true }

  // かっこ内の g / ml(「1枚(250g)」)は、補足の重さ・量として持つ(食材の単位が g / ml のときだけ使う)
  const paren = text.match(/[(（](?:約|計)?(\d+(?:\.\d+)?)(g|ml|cc)[)）]/i)
  if (paren) {
    if (paren[2].toLowerCase() === 'g') result.grams = Number(paren[1])
    else result.ml = Number(paren[1])
  }

  const spoon = text.match(/^(大さじ|小さじ|カップ)([0-9./½¼¾と]+)/)
  if (spoon) {
    const n = parseNumber(spoon[2])
    if (n != null) {
      result.quantity = n
      result.unit = spoon[1]
      result.ml = n * SPOON[spoon[1]]
    }
    return result
  }

  // 「40〜50g」: 幅として持つ(quantity は先頭の数。画面で分量を確かめてもらう)
  const m = text.match(/^([0-9./½¼¾⅓⅔と]+)(?:[〜~～-]([0-9./]+))?([^\d(（]*)/)
  if (m) {
    const n = parseNumber(m[1])
    const unit = m[3].replace(/分$/, '').replace(/^cc$/i, 'ml').trim()
    if (n != null && n > 0) {
      result.quantity = n
      result.unit = unit || '個'
      if (m[2] != null) result.range = [n, parseNumber(m[2])]
      if (/^g$/i.test(result.unit)) {
        result.unit = 'g'
        if (!result.range) result.grams = n
      } else if (/^kg$/i.test(result.unit)) {
        result.unit = 'g'
        result.quantity = n * 1000
        if (!result.range) result.grams = n * 1000
      } else if (/^ml$/i.test(result.unit)) {
        result.unit = 'ml'
        if (!result.range) result.ml = n
      }
    }
  }
  return result
}

const LEADING_MARKS = /^(?:[★☆●○◎◇◆■□▲△・*※＊]+|[(（【\[<＜]?[A-ZＡ-Ｚa-z][)）】\]>＞][:：]?|[A-Z][:：]?\s)\s*/

// かっこの中身(注記)を取り出す
function bracketNotes(text) {
  return [...toHalfWidth(text).matchAll(BRACKET)].map((m) => m[1].trim()).filter(Boolean)
}

export function parseIngredientLine(raw) {
  // 名前と分量を「…」で区切る書き方(「塩…小さじ1/4」)は空白とみなす。グループの記号(「Aみりん」の A)は外す
  const line = String(raw ?? '')
    .replace(/\s*[…‥]+\s*/g, ' ')
    .replace(/ɡ/g, 'g')
    .trim()
    .replace(/^[A-EＡ-Ｅ](?=[\u3040-\u30ff\u4e00-\u9fff])/, '')
  const notes = []
  let name
  let amountText = ''
  let tokens = line.split(/[\s　]+/).filter(Boolean)
  // 分量の後ろに続く言葉(「豚バラ肉 1枚 冷凍」の「冷凍」)は注記にする
  let split = -1
  for (let i = tokens.length - 1; i >= 1; i--) {
    if (AMOUNT_START.test(toHalfWidth(tokens[i]))) split = i
    else if (split !== -1) break
  }
  if (split > 0) {
    name = tokens.slice(0, split).join(' ')
    const rest = tokens.slice(split)
    const amountTokens = []
    for (const t of rest) {
      if (amountTokens.length === 0 || AMOUNT_START.test(toHalfWidth(t)) || /^[(（[【].*[)）\]】]$/.test(t)) amountTokens.push(t)
      else notes.push(t)
    }
    amountText = amountTokens.join(' ')
  } else {
    // 空白なしで続く場合(「しょうが1かけ」「じゃがいも (計250g)2個」)。かっこの中の数字は分量の始まりにしない
    // かっこの外にある最初の数字から後ろを分量にする
    let depth = 0
    let at = -1
    const chars = [...line]
    for (let i = 1; i < chars.length; i++) {
      const c = chars[i]
      if ('(（[【<＜'.includes(c)) depth++
      else if (')）]】>＞'.includes(c)) depth = Math.max(0, depth - 1)
      else if (depth === 0 && /[0-9０-９]/.test(c)) {
        at = i
        break
      }
    }
    if (at > 0) {
      let start = at
      const head = chars.slice(0, at).join('')
      const prefix = head.match(/(?:各|それぞれ|約|大さじ|小さじ|カップ)+$/)
      if (prefix) start = at - [...prefix[0]].length
      name = chars.slice(0, start).join('').trim()
      amountText = chars.slice(start).join('')
      if (!name) {
        name = line
        amountText = ''
      }
    } else {
      // 「有塩バター適量」のように、空白なしで あいまいな分量が続く
      const vague = line.match(new RegExp(`^(.+?)((?:${SHARED})?(?:${VAGUE.join('|')}))$`))
      if (vague) {
        name = vague[1]
        amountText = vague[2]
      } else {
        name = line
      }
    }
  }
  // 名前の後ろのかっこ(「じゃがいも (計250g)」「玉ねぎ (1/2個)」)は補足。分量が別にあれば注記にする
  name = name.replace(LEADING_MARKS, '').trim()
  // 分量の中のかっこ(「2個(計300g)」「0.5缶 (ホール)」)の言葉は、g / ml 以外は注記
  for (const n of bracketNotes(amountText)) if (!/^(?:約|計)?\d+(?:\.\d+)?(?:g|ml|cc)$/i.test(n)) notes.push(n)
  for (const n of bracketNotes(name)) notes.push(n)
  // 分量がかっこの中にだけある(「しいたけ（2個）」「豚こま切れ肉（200g）」)
  if (!amountText) {
    const i = notes.findIndex((n) => AMOUNT_START.test(toHalfWidth(n)))
    if (i !== -1) amountText = notes.splice(i, 1)[0]
  }
  // 名前がかっこだけ(「【牛肉】」)のときは、中身を名前にする
  const bare = name.replace(BRACKET, '').trim()
  if (!bare && notes.length) name = notes.shift()
  const amount = parseAmount(amountText)
  // 名前の後ろのかっこにだけ分量がある(「じゃがいも (2個)400g」の 2個)は補足として残す
  return { raw: line, name, amountText: amountText.trim(), notes, ...amount }
}

// 「＜タレ＞」「【A】」「◆合わせだれ」「A:」「下味」「1.」のような見出しだけの行(分量がない)
const GROUP_WORDS = [
  '材料', '調味料', '合わせ調味料', 'たれ', 'タレ', 'だれ', 'ソース', '下味', '付け合わせ', 'つけあわせ', 'トッピング', '仕上げ', '仕上げ用',
  '飾り', '飾り用', '肉だね', 'たね', '煮汁', '生地', '衣', '具', '具材', 'お好みで', '合わせだれ', 'ドレッシング', 'スープ', '下ごしらえ',
]
export function isHeadingLine(raw) {
  const t = toHalfWidth(raw).trim()
  if (!t) return true
  if (/[0-9]/.test(t.replace(/^\d+[.)]$/, '')) || /適量|少々|ひとつまみ/.test(t)) return false
  // 記号・番号だけ
  if (/^[\p{P}\p{S}\s]+$/u.test(t) || /^\d+[.)]$/.test(t)) return true
  // 「A」「A:」「(A)」「【A】」
  if (/^[(【[<]?[A-Za-z][)】\]>]?[:]?$/.test(t)) return true
  // 末尾がコロン
  if (/[:]$/.test(t)) return true
  const body = t
    .replace(BRACKET, '')
    .replace(/^[★☆●○◎◇◆■□▲△・*※＊]+/, '')
    .replace(/[:]$/, '')
    .replace(/[A-Za-z]$/, '')
    .trim()
  if (GROUP_WORDS.includes(body)) return true
  // 「〈調味料〉」「[合わせ調味料]」「＜タレ＞」: 全体がかっこ
  if (/^[<＜【\[(（〈《].*[>＞】\])）〉》]$/.test(t)) return true
  // 先頭に見出しの記号があり、分量がない(「◆合わせだれ」「☆調味料 (下ごしらえ)」)
  if (/^[★☆●○◎◇◆■□▲△]/.test(t)) return true
  return false
}

// 複数の食材をまとめて書いた行(「酒・醤油 各小さじ1/2」「塩、粗挽き黒こしょう 少々」)を食材ごとに分ける。
// 「各」「それぞれ」か、分量があいまい(少々・適量)なら同じ分量を付ける。
// 数値の分量で「各」がない(「酒・みりん 大さじ1」)と、1つずつの量か合計かが分からないので、分量は空にして確かめてもらう
const SEPARATORS = /[・、,，／]|(?<![0-9])\/(?![0-9])/
export function splitIngredientLine(parsed) {
  const outside = parsed.name.replace(BRACKET, '')
  const bySep = outside.split(SEPARATORS).map((s) => s.trim()).filter(Boolean)
  let names = bySep.length >= 2 ? bySep : null
  // 「と」は、「各」「それぞれ」か分量があいまいなときだけ区切りとみなす(「とうもろこし」のように名前の先頭の「と」では分けない)
  if (!names && (parsed.shared || parsed.vague)) {
    const byTo = outside.split('と').map((s) => s.trim())
    if (byTo.length >= 2 && byTo.every((s) => s.length >= 1)) names = byTo
  }
  if (!names || !names.every((n) => n.length >= 1)) return [parsed]
  const common = parsed.shared || parsed.vague
  return names.map((name) => ({
    ...parsed,
    name,
    ...(common ? {} : { quantity: null, unit: null, grams: null, ml: null, sharedUnknown: true }),
    splitFrom: parsed.raw,
  }))
}
