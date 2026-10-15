import { CATEGORIES, categoryInfo } from '@/lib/recipeCategory'
import { Label } from '@/components/ui/label'

// 料理のカテゴリ(1つ)。自動の分類を選んだ状態で出し、押すと利用者の選択(manual)になる。
// value: 利用者が選んだカテゴリ(null は自動)。auto: 料理名・材料などからの自動の分類
export function RecipeCategoryField({ value, auto, onChange }) {
  const manual = value != null
  const current = manual ? value : auto
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>料理のカテゴリ</Label>
        <span className="text-xs text-muted-foreground">
          {manual ? (
            <button type="button" className="underline underline-offset-2" onClick={() => onChange(null)}>
              自動に戻す
            </button>
          ) : (
            `自動で「${categoryInfo(auto).label}」にしました(変えられます)`
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="料理のカテゴリ">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={current === c.id}
            className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              current === c.id ? 'border-primary bg-primary font-semibold text-primary-foreground shadow-sm' : 'bg-card text-muted-foreground'
            }`}
            onClick={() => onChange(c.id)}
          >
            <span aria-hidden="true">{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}
