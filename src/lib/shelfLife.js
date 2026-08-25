const MS_PER_DAY = 1000 * 60 * 60 * 24
const DEFAULT_SHELF_LIFE_DAYS = 7

// ロット一覧の中で一番古い(=先に傷む)追加日を取り出す。日付未定のロットは対象外。
function oldestAddedOn(batchesForIngredient) {
  const dated = (batchesForIngredient ?? []).filter((b) => b.added_on && Number(b.quantity) > 0)
  if (dated.length === 0) return null
  return dated.reduce((oldest, b) => (b.added_on < oldest ? b.added_on : oldest), dated[0].added_on)
}

// 賞味期限の目安(在庫の中で一番古いロット基準)を計算する。
// 日付が記録されたロットが一つもない場合は null(期限不明として扱う)。
export function getExpiryInfo(ingredient, batchesForIngredient, catalogById) {
  const addedOn = oldestAddedOn(batchesForIngredient)
  if (!addedOn) return null

  const shelfLifeDays = catalogById?.get(ingredient.catalog_id)?.shelf_life_days ?? DEFAULT_SHELF_LIFE_DAYS

  const addedDate = new Date(`${addedOn}T00:00:00`)
  const expiryDate = new Date(addedDate.getTime() + shelfLifeDays * MS_PER_DAY)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((expiryDate.getTime() - today.getTime()) / MS_PER_DAY)

  return { expiryDate, daysLeft }
}

export function formatExpiryLabel(daysLeft) {
  if (daysLeft < 0) return '期限切れ'
  if (daysLeft === 0) return '本日まで'
  return `あと${daysLeft}日`
}
