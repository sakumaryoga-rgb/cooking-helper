import { Badge } from '@/components/ui/badge'

export function MakeableBadge({ status }) {
  if (!status) return null

  if (status.makeable) {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900">
        作れます
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-800"
    >
      あと{status.shortfallCount}品
    </Badge>
  )
}
