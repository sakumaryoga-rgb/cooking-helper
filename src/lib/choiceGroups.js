// レシピの「どれか1つ」の材料(choice_group)を編集するときの組の操作(材料の編集画面で使う)

// 「代わりの材料」を足す: 元の材料と同じ組に入れ(組がなければ新しい番号)、組の最後の行のすぐ後ろに置く。
// 分量は元の材料と同じ単位なら同じ量を初期値にする
export function addAlternative(items, baseKey, added) {
  const base = items.find((i) => i.key === baseKey)
  if (!base) return [...items, added]
  const used = items.map((i) => i.choiceGroup).filter((g) => g != null)
  const group = base.choiceGroup ?? Math.min(50, (used.length ? Math.max(...used) : 0) + 1)
  const next = items.map((i) => (i.key === baseKey ? { ...i, choiceGroup: group } : i))
  const lastIndex = next.reduce((at, i, idx) => (i.choiceGroup === group ? idx : at), -1)
  const alt = {
    ...added,
    choiceGroup: group,
    optional: Boolean(base.optional),
    requiredQuantity: base.unit && base.unit === added.unit && base.requiredQuantity !== '' ? base.requiredQuantity : added.requiredQuantity,
  }
  return [...next.slice(0, lastIndex + 1), alt, ...next.slice(lastIndex + 1)]
}

// 候補が1つだけになった組は解除する
export function dissolveSingletons(items) {
  const count = new Map()
  for (const i of items) if (i.choiceGroup != null) count.set(i.choiceGroup, (count.get(i.choiceGroup) ?? 0) + 1)
  return items.map((i) => (i.choiceGroup != null && count.get(i.choiceGroup) < 2 ? { ...i, choiceGroup: null } : i))
}
