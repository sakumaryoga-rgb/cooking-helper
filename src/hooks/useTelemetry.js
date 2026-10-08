import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { installErrorListeners, recordPageView, setTelemetryContext } from '@/lib/telemetry/telemetry'

// 画面遷移がリダイレクト(/ → /fridge など)で続くとき、最後の画面だけを1PVにするための待ち時間
export const PAGE_VIEW_SETTLE_MS = 400

export function useTelemetry({ userId, groupId, ready }) {
  const { pathname } = useLocation()

  useEffect(() => installErrorListeners(), [])

  useEffect(() => {
    setTelemetryContext({ userId, groupId })
  }, [userId, groupId])

  useEffect(() => {
    // グループの読み込み中は group_id が決まらないので待つ
    if (!ready || !userId) return
    const timer = setTimeout(() => recordPageView(pathname), PAGE_VIEW_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [pathname, userId, groupId, ready])
}
