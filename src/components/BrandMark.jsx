import { APP_ICON_SRC, APP_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'

// 公式アイコンと「COOKDOOR」のロゴ表示。アイコンは装飾なので代替テキストは空にし、名称はテキストで読ませる
export function BrandMark({ size = 'md', showName = true, className }) {
  const iconSize = size === 'sm' ? 'size-6 rounded-md' : size === 'lg' ? 'size-16 rounded-2xl' : 'size-10 rounded-xl'
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img src={APP_ICON_SRC} alt="" width={192} height={192} className={cn('shrink-0', iconSize)} />
      {showName && <span className="font-semibold tracking-wide">{APP_NAME}</span>}
    </span>
  )
}
