// 別名を覚えた・消したことを、読み込み済みの一覧(共有元)に知らせる。別名はリアルタイムの通知を受けないため
export const ALIASES_CHANGED = 'cookdoor:aliases-changed'

export function notifyAliasesChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ALIASES_CHANGED))
}
