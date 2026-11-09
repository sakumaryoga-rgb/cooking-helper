// 材料の「必須 / 任意」を切り替える2択のスイッチ。どちらが選ばれているかが一目でわかるよう、両方を並べて出す
export function RequiredToggle({ name, optional, onChange, disabled = false, size = 'sm' }) {
  const pad = size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
  const option = (value, label, active) => (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={() => !active && onChange(value)}
      className={`rounded-full font-semibold transition-colors ${pad} ${
        active
          ? value
            ? 'bg-sky-500 text-white shadow-sm dark:bg-sky-600'
            : 'bg-foreground text-background shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
  return (
    <span role="radiogroup" aria-label={`${name}は必須か任意か`} className="inline-flex shrink-0 items-center gap-0.5 rounded-full border bg-muted/50 p-0.5">
      {option(false, '必須', !optional)}
      {option(true, '任意', Boolean(optional))}
    </span>
  )
}
