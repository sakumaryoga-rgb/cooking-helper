// 数量の読み取りと表示。小数(0.5)と分数(1/2・½・1と1/2)を同じ数として扱う。
// 保存するのは常に数(numeric)。分数は小数第6位までに丸める(1/3 → 0.333333)

const UNICODE_FRACTIONS = { '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4], '⅕': [1, 5], '⅛': [1, 8] }
const PRECISION = 1e6

export function roundQuantity(n) {
  return Math.round(n * PRECISION) / PRECISION
}

function normalize(text) {
  return String(text ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[／⁄]/g, '/')
    .replace(/[＋]/g, '+')
    .replace(/\s+/g, ' ')
    .trim()
}

// 数として読めれば数、読めなければ null。0 以下も null(在庫や分量に使うため)
// 読める例: 2、0.5、.5、1/2、½、1½、1と1/2、1 1/2、1+1/2、半分
export function parseQuantity(text) {
  let t = normalize(text)
  if (!t) return null
  if (/^(半分|半)$/.test(t)) return 0.5
  // 「1½」「1と½」→ 整数 + 分数
  t = t.replace(/(\d*)\s*(?:と|\+)?\s*([½⅓⅔¼¾⅕⅛])$/, (_, whole, f) => {
    const [n, d] = UNICODE_FRACTIONS[f]
    return whole ? `${whole}と${n}/${d}` : `${n}/${d}`
  })
  let n = null
  let m = t.match(/^(\d+)\s*(?:と|\+| )\s*(\d+)\s*\/\s*(\d+)$/)
  if (m) n = Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null
  else if ((m = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/))) n = Number(m[2]) ? Number(m[1]) / Number(m[2]) : null
  else if (/^(\d+\.?\d*|\.\d+)$/.test(t)) n = Number(t)
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  return roundQuantity(n)
}

const NICE_DENOMINATORS = [2, 3, 4]

// 3分の1のように小数で割り切れない値だけ分数で返す({ whole, num, den })。それ以外は null
function asThirds(n) {
  const whole = Math.floor(n + 1e-9)
  const frac = n - whole
  if (frac < 1e-4) return null
  for (const den of NICE_DENOMINATORS) {
    const num = Math.round(frac * den)
    if (num > 0 && num < den && Math.abs(frac - num / den) < 1e-4) return den === 3 ? { whole, num, den } : null
  }
  return null
}

// 一覧などの表示。基本は小数第2位まで(0.5、1.25)。1/3・2/3 は小数だと割り切れないので分数で出す
export function formatQuantity(quantity) {
  const num = Number(quantity)
  if (!Number.isFinite(num)) return '0'
  const f = num > 0 ? asThirds(num) : null
  if (f) return f.whole ? `${f.whole}と${f.num}/${f.den}` : `${f.num}/${f.den}`
  return String(Math.round(num * 100) / 100)
}

// 分数ボタン用: 今の値の整数部分を残して、端数を frac にする(1.5 で ¼ → 1と1/4)
export function withFraction(current, [num, den]) {
  const n = parseQuantity(current) ?? 0
  const whole = Math.floor(n + 1e-9)
  return whole ? `${whole}と${num}/${den}` : `${num}/${den}`
}

// 在庫を使い切るときの端数(1/3 を3回引いて 0.000001 残るなど)を残さない。
// 使う量が在庫とほぼ同じ(差が0.01未満)なら、在庫ちょうどを使う
export function snapToStock(quantity, stock) {
  const q = Number(quantity)
  const s = Number(stock)
  if (!(q > 0) || !(s > 0)) return q
  return Math.abs(s - q) < 0.01 ? s : q
}
