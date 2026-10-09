// 作れるかどうかの札。文言は従来どおり、見た目だけ丸い札に絵文字を添える
const STYLES = {
  makeable: { emoji: '✨', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  substitutable: { emoji: '🪄', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  empty: { emoji: '📝', cls: 'bg-muted text-muted-foreground' },
  almost: { emoji: '🛒', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  short: { emoji: '🛒', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' },
}

export function MakeableBadge({ status }) {
  if (!status) return null
  const style = STYLES[status.level] ?? STYLES.short
  const label =
    status.level === 'makeable'
      ? '作れます'
      : status.level === 'substitutable'
        ? '代替で作れます'
        : status.level === 'empty'
          ? '材料未登録'
          : `あと${status.shortfallCount}品`
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.cls}`}>
      <span aria-hidden="true">{style.emoji}</span>
      {label}
    </span>
  )
}
