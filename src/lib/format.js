// 数量表示: 整数ならそのまま、小数なら小数第1位まで表示する
export function formatQuantity(quantity) {
  const num = Number(quantity)
  if (Number.isNaN(num)) return '0'
  return Number.isInteger(num) ? String(num) : num.toFixed(1)
}
