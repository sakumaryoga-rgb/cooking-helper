import { Badge } from '@/components/ui/badge'

export function MakeableBadge({ status }) {
  if (!status) return null

  if (status.level === 'makeable') {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900">
        作れます
      </Badge>
    )
  }

  if (status.level === 'empty') {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        材料未登録
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className={
        status.level === 'almost'
          ? 'text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-800'
          : 'text-red-700 border-red-300 dark:text-red-400 dark:border-red-800'
      }
    >
      あと{status.shortfallCount}品
    </Badge>
  )
}
