// レシピの評価(recipes.rating: 0.5〜5 の 0.5 刻み。null は未評価)

// 評価の高い順(未評価は後ろ)。同じ評価は元の並びのまま
export function compareRating(a, b) {
  const ra = a == null ? -1 : Number(a)
  const rb = b == null ? -1 : Number(b)
  return rb - ra
}
