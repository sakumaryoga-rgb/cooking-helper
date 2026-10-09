// オリジナルレシピの手順(手順ごとの文と、使う材料・量)。
// 編集中: [{ id, text, uses: [{ itemKey, quantity }] }](itemKey は材料の一覧の行の key)
// 保存(recipes.steps): [{ text, uses: [{ ingredient_id | source_name, quantity }] }]
// 手順ごとの量は表示の目安で、在庫の減算には使わない(レシピ全体の材料の分量だけで減らす)

let nextId = 0
export const stepId = () => `step-${nextId++}`

export function emptyStep() {
  return { id: stepId(), text: '', uses: [] }
}

// 作り方の文(1手順1行)を手順にする(手順ごとの材料が未設定の、既存のレシピ)
export function stepsFromInstructions(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((s) => s.trim().replace(/^\d+[.)、.]\s*/, ''))
    .filter(Boolean)
  return lines.length ? lines.map((line) => ({ id: stepId(), text: line, uses: [] })) : [emptyStep()]
}

// 保存した手順を、編集中の形に戻す(材料は食材 ID か確認待ちの名前で、一覧の行に結び付ける)
export function stepsFromSaved(saved, instructions, items) {
  if (!Array.isArray(saved) || saved.length === 0) return stepsFromInstructions(instructions)
  return saved.map((s) => ({
    id: stepId(),
    text: String(s.text ?? ''),
    uses: (s.uses ?? [])
      .map((u) => {
        const item = items.find((i) =>
          u.ingredient_id ? i.ingredient?.id === u.ingredient_id : !i.ingredient && (i.sourceName ?? i.name) === u.source_name
        )
        return item ? { itemKey: item.key, quantity: u.quantity ?? '' } : null
      })
      .filter(Boolean),
  }))
}

// 作り方の文(instructions)。従来どおり1手順1行
export function stepsToInstructions(steps) {
  return steps
    .map((s) => s.text.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

// 保存する形にする。targetOf(item) → { ingredient_id } | { source_name } | null(材料から外した行)
export function stepsToSaved(steps, items, targetOf) {
  const out = []
  for (const s of steps) {
    const text = s.text.replace(/\s*\n\s*/g, ' ').trim()
    const uses = []
    for (const u of s.uses) {
      const item = items.find((i) => i.key === u.itemKey && i.include)
      const target = item ? targetOf(item) : null
      if (!target) continue
      const q = Number(u.quantity)
      uses.push({ ...target, quantity: q > 0 ? q : null })
    }
    if (text || uses.length) out.push({ text, uses })
  }
  return out
}

// 手順ごとの量の合計と、レシピの材料の分量が違う材料(自動では直さず、画面で知らせる)
export function usageMismatches(steps, items) {
  const totals = new Map()
  for (const s of steps) {
    for (const u of s.uses) {
      const q = Number(u.quantity)
      if (!(q > 0)) continue
      totals.set(u.itemKey, Math.round(((totals.get(u.itemKey) ?? 0) + q) * 100) / 100)
    }
  }
  const out = []
  for (const [key, total] of totals) {
    const item = items.find((i) => i.key === key)
    if (!item || !item.include) continue
    const recipeQty = Number(item.requiredQuantity)
    if (recipeQty > 0 && Math.abs(recipeQty - total) > 1e-6) out.push({ key, name: item.name, unit: item.unit, stepsTotal: total, recipeQuantity: recipeQty })
  }
  return out
}

// 詳細画面用: 保存した手順の、材料ごとの合計とレシピの分量の違い
export function savedUsageMismatches(steps, recipeIngredients) {
  if (!Array.isArray(steps)) return []
  const totals = new Map()
  for (const s of steps) {
    for (const u of s.uses ?? []) {
      const q = Number(u.quantity)
      if (!(q > 0) || !u.ingredient_id) continue
      totals.set(u.ingredient_id, Math.round(((totals.get(u.ingredient_id) ?? 0) + q) * 100) / 100)
    }
  }
  const out = []
  for (const [id, total] of totals) {
    const ri = recipeIngredients.find((r) => r.ingredient_id === id)
    const recipeQty = Number(ri?.required_quantity)
    if (ri && recipeQty > 0 && Math.abs(recipeQty - total) > 1e-6) out.push({ ingredientId: id, stepsTotal: total, recipeQuantity: recipeQty })
  }
  return out
}
