import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// 料理の絵の候補(空 = 料理名から自動で選ぶ)
export const DISH_ICONS = ['🍳', '🍛', '🍜', '🍝', '🍚', '🍣', '🥗', '🍲', '🐟', '🍖', '🍤', '🥟', '🍕', '🥪', '🍰', '🍙', '🌮', '🥘']

// 作り方・メモ・人数・絵(追加・編集で共通)。value = { icon, servings, instructions, memo }
export function RecipeExtrasFields({ value, onChange }) {
  return (
    <>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">料理の絵</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="料理の絵">
          <button
            type="button"
            role="radio"
            aria-checked={!value.icon}
            onClick={() => onChange({ icon: '' })}
            className={`h-10 rounded-xl border px-3 text-xs ${!value.icon ? 'border-primary bg-primary/20 font-semibold' : 'bg-card text-muted-foreground'}`}
          >
            おまかせ
          </button>
          {DISH_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={value.icon === icon}
              aria-label={`絵 ${icon}`}
              onClick={() => onChange({ icon })}
              className={`size-10 rounded-xl border text-xl transition-transform ${value.icon === icon ? 'scale-110 border-primary bg-primary/20' : 'bg-card'}`}
            >
              {icon}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipe-servings">何人分</Label>
        <Input
          id="recipe-servings"
          type="number"
          inputMode="numeric"
          min="1"
          max="99"
          className="w-24"
          value={value.servings ?? ''}
          onChange={(e) => onChange({ servings: e.target.value })}
          placeholder="例: 2"
        />
      </div>


      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipe-memo">わが家のメモ</Label>
        <Textarea
          id="recipe-memo"
          rows={2}
          maxLength={1000}
          value={value.memo ?? ''}
          onChange={(e) => onChange({ memo: e.target.value })}
          placeholder="例: 砂糖を少し多めにすると子どもが喜ぶ"
        />
      </div>
    </>
  )
}

// 入力値を保存用に整える(人数は1〜99の整数、空なら null)
export function normalizeExtras(value) {
  const n = Number.parseInt(value.servings, 10)
  return {
    icon: value.icon || null,
    servings: Number.isFinite(n) && n >= 1 && n <= 99 ? n : null,
    instructions: (value.instructions ?? '').trim() || null,
    memo: (value.memo ?? '').trim() || null,
  }
}
