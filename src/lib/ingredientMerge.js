import { nameKey } from '@/lib/ingredientName'

// 表記揺れの候補: 片方の名前がもう片方を含む食材の組(「豚バラ」と「豚バラ肉」など)。
// 単位が違って両方に在庫があるものはまとめられないので出さない
export function similarPairs(ingredients, limit = 5) {
  const list = (ingredients ?? []).map((i) => ({ i, k: nameKey(i.name) })).filter((x) => x.k.length >= 2)
  const pairs = []
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const [x, y] = list[a].k.length <= list[b].k.length ? [list[a], list[b]] : [list[b], list[a]]
      if (!y.k.includes(x.k)) continue
      if (x.i.unit !== y.i.unit && Number(y.i.quantity) > 0 && Number(x.i.quantity) > 0) continue
      // 短い名前(家で使っている名前のことが多い)を残す候補にする。在庫がない方をまとめる
      const keep = Number(y.i.quantity) > 0 && !(Number(x.i.quantity) > 0) ? y.i : x.i
      const drop = keep === x.i ? y.i : x.i
      if (keep.unit !== drop.unit && Number(drop.quantity) > 0) continue
      pairs.push({ keep, drop })
      if (pairs.length >= limit) return pairs
    }
  }
  return pairs
}
