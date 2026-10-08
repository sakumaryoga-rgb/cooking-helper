import { DB_ENABLED } from '@/lib/runtimeEnv'

// Vercel の Preview など、本番DBに接続しないビルドであることを常に表示する
export function PreviewBanner() {
  if (DB_ENABLED) return null
  return (
    <div role="note" className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
      プレビュー環境：データベースに接続していません
    </div>
  )
}
