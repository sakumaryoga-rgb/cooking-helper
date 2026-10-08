// 在庫ロットの期限。ロットごとに、入力された期限(消費期限・賞味期限)を優先し、
// なければ購入日 + 食材マスタの日持ち日数(なければ7日)の「推定」期限を使う(DB の FEFO と同じ規則)。
const MS_PER_DAY = 1000 * 60 * 60 * 24
const DEFAULT_SHELF_LIFE_DAYS = 7
export const SOON_DAYS = 2

export const EXPIRY_KIND_LABEL = { use_by: '消費期限', best_before: '賞味期限', estimated: '推定' }

function parseDate(value) {
  return new Date(`${value}T00:00:00`)
}

function today() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// 1つのロットの期限。期限が分からない(購入日も期限もない)ロットは null
export function getBatchExpiry(batch, ingredient, catalogById) {
  let kind = null
  let date = null
  if (batch.use_by) {
    kind = 'use_by'
    date = parseDate(batch.use_by)
  } else if (batch.best_before) {
    kind = 'best_before'
    date = parseDate(batch.best_before)
  } else if (batch.added_on) {
    const days = catalogById?.get(ingredient?.catalog_id)?.shelf_life_days ?? DEFAULT_SHELF_LIFE_DAYS
    kind = 'estimated'
    date = new Date(parseDate(batch.added_on).getTime() + days * MS_PER_DAY)
  }
  if (!date) return null
  const daysLeft = Math.round((date.getTime() - today().getTime()) / MS_PER_DAY)
  return { expiryDate: date, daysLeft, kind, estimated: kind === 'estimated' }
}

// 食材の期限 = 在庫のあるロットのうち、いちばん早い期限(FEFO で次に使うロット)
export function getExpiryInfo(ingredient, batchesForIngredient, catalogById) {
  let nearest = null
  for (const batch of batchesForIngredient ?? []) {
    if (!(Number(batch.quantity) > 0)) continue
    const info = getBatchExpiry(batch, ingredient, catalogById)
    if (info && (!nearest || info.expiryDate < nearest.expiryDate)) nearest = info
  }
  return nearest
}

// 'expired'(期限切れ)/ 'soon'(2日以内)/ 'ok' / 'none'(期限未設定)
export function getExpiryState(info) {
  if (!info) return 'none'
  if (info.daysLeft < 0) return 'expired'
  if (info.daysLeft <= SOON_DAYS) return 'soon'
  return 'ok'
}

export function formatExpiryLabel(daysLeft) {
  if (daysLeft < 0) return '期限切れ'
  if (daysLeft === 0) return '本日まで'
  return `あと${daysLeft}日`
}

export function formatMonthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// 「消費期限 10/12・あと2日」「推定 10/12・期限切れ」
export function describeExpiry(info) {
  if (!info) return '期限未設定'
  return `${EXPIRY_KIND_LABEL[info.kind]} ${formatMonthDay(info.expiryDate)}・${formatExpiryLabel(info.daysLeft)}`
}
