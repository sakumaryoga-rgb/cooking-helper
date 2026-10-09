import { createContext, useContext } from 'react'

// 選んでいる家のデータ(食材・レシピ・ロット・食材マスタ・代替・別名)を、Layout で1回だけ読み込んで画面間で共有する。
// タブを移るたびに読み直さないので、切り替えがすぐ終わる。リアルタイムの変更は共有元が受け取る。
// Provider の外(テストや単独の画面)では、各フックがこれまでどおり自分で読み込む
export const KitchenDataContext = createContext(null)

export function useSharedKitchen(key, groupId) {
  const shared = useContext(KitchenDataContext)
  if (!shared) return null
  // 別の家のデータは使わない(家を切り替えた直後など)
  if (groupId !== undefined && shared.groupId !== groupId) return null
  return shared[key] ?? null
}

// リアルタイムの通知が続けて届いたとき(在庫の増減で食材とロットが同時に変わるなど)、まとめて1回だけ読み直す
export function debounce(fn, ms = 150) {
  let timer = null
  const run = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  run.cancel = () => clearTimeout(timer)
  return run
}
