// 「鶏むね肉 1枚(250g)」「S&B 本鶏だし 1パック」「塩 少々」のような材料の1行を、
// 食材名と分量に分ける。分量は数値と単位に読めた場合だけ quantity / unit を入れる。

const VAGUE = ['適量', '少々', '適宜', 'お好みで', '好みで', 'ひとつまみ', '少量', 'たっぷり', '各適量', '各少々']
const SPOON = { 大さじ: 15, 小さじ: 5, カップ: 200 } // ml
const AMOUNT_START = new RegExp(`^(?:[0-9.\\/½¼¾⅓⅔]|大さじ|小さじ|カップ|各|約|${VAGUE.join('|')})`)

function toHalfWidth(text) {
  return String(text).normalize('NFKC')
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

export function parseAmount(amountText) {
  const text = toHalfWidth(amountText).replace(/\s+/g, '').replace(/^(各|約)/, '')
  const result = { quantity: null, unit: null, grams: null, ml: null, vague: false }
  if (!text) return result
  if (VAGUE.some((v) => text.startsWith(v))) return { ...result, vague: true }

  // かっこ内の g / ml(「1枚(250g)」)
  const paren = text.match(/[(（]約?(\d+(?:\.\d+)?)(g|ml|cc)[)）]/i)
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

  // 「40〜50g」は先頭の数を使う
  const m = text.match(/^([0-9./½¼¾⅓⅔と]+)(?:[〜~-][0-9./]+)?([^\d(（]*)/)
  if (m) {
    const n = parseNumber(m[1])
    const unit = m[2].replace(/分$/, '').replace(/^cc$/i, 'ml').trim()
    if (n != null && n > 0) {
      result.quantity = n
      result.unit = unit || '個'
      if (/^g$/i.test(result.unit)) {
        result.unit = 'g'
        result.grams = n
      } else if (/^ml$/i.test(result.unit)) {
        result.unit = 'ml'
        result.ml = n
      }
    }
  }
  return result
}

const LEADING_MARKS = /^(?:[★☆●○◎◇◆■□▲△・*※]+|[(（【\[<＜]?[A-ZＡ-Ｚa-z][)）】\]>＞]|[A-Z]\s)\s*/

export function parseIngredientLine(raw) {
  const line = String(raw ?? '').trim()
  const tokens = line.split(/[\s　]+/).filter(Boolean)
  let split = -1
  for (let i = tokens.length - 1; i >= 1; i--) {
    if (AMOUNT_START.test(toHalfWidth(tokens[i]))) split = i
    else if (split !== -1) break
  }
  let name
  let amountText
  if (split > 0) {
    name = tokens.slice(0, split).join(' ')
    amountText = tokens.slice(split).join(' ')
  } else {
    // 空白なしで「しょうが1かけ」のように続く場合
    const m = line.match(/^(.*?[^\d\s.\/])((?:大さじ|小さじ|カップ)?[0-9０-９][\s\S]*)$/)
    if (m && m[1].length >= 1) {
      name = m[1]
      amountText = m[2]
    } else {
      name = line
      amountText = ''
    }
  }
  name = name.replace(LEADING_MARKS, '').trim()
  return { raw: line, name, amountText: amountText.trim(), ...parseAmount(amountText) }
}

// 「＜タレ＞」「【A】」のような見出しだけの行
export function isHeadingLine(raw) {
  const t = String(raw ?? '').trim()
  return /^[<＜【\[(（■●◆].*[>＞】\])）]?$/.test(t) && !/[0-9０-９]|適量|少々/.test(t) && t.length <= 20
}
