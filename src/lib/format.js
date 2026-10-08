// 数量表示: 小数第2位までに丸め、末尾の0は付けない(0.25 → "0.25"、1.5 → "1.5"、2 → "2")
export function formatQuantity(quantity) {
  const num = Number(quantity)
  if (!Number.isFinite(num)) return '0'
  return String(Math.round(num * 100) / 100)
}
