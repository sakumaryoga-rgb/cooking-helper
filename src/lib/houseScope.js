// 共通の行(group_id なし)と、選んでいる家の行だけを使う。
// 読み取りの権限は「所属している家」なので(migration 029)、複数の家に入っている人には別の家の行も届く。
// 画面や照合には、選んでいる家と共通の行だけを使い、家どうしのデータを混ぜない
export function inHouse(row, groupId) {
  if (!row) return false
  return row.group_id == null || (groupId != null && row.group_id === groupId)
}

export function filterHouse(rows, groupId) {
  return (rows ?? []).filter((row) => inHouse(row, groupId))
}

// リアルタイムの通知が選んでいる家に関係するか。
// 削除の通知は主キーしか届かないことがある(group_id が分からない)ので、関係あるものとして扱う
export function eventInHouse(payload, groupId) {
  const rows = [payload?.new, payload?.old].filter((r) => r && Object.keys(r).length > 0)
  if (rows.length === 0) return true
  return rows.some((r) => !('group_id' in r) || inHouse(r, groupId))
}
