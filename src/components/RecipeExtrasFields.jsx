import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

      <StepsEditor value={value.instructions ?? ''} onChange={(instructions) => onChange({ instructions })} />

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

// 作り方を、番号付きの手順の一覧で入力する(保存は1手順1行のテキスト。DB の形は変えない)
function toSteps(text) {
  const steps = String(text ?? '')
    .split('\n')
    .map((s) => s.trim().replace(/^\d+[.)、.]\s*/, ''))
    .filter(Boolean)
  return steps.length ? steps : ['']
}

export function StepsEditor({ value, onChange }) {
  const [steps, setSteps] = useState(() => toSteps(value))

  function update(next) {
    setSteps(next)
    // 手順の中の改行は1行にまとめる(1手順1行で保存するため)
    onChange(next.map((s) => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n'))
  }

  const set = (i, text) => update(steps.map((s, j) => (j === i ? text : s)))
  const remove = (i) => update(steps.length === 1 ? [''] : steps.filter((_, j) => j !== i))
  const move = (i, d) => {
    const next = [...steps]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    update(next)
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">作り方</legend>
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground" aria-hidden="true">
              {i + 1}
            </span>
            <Textarea
              aria-label={`手順${i + 1}`}
              rows={2}
              maxLength={500}
              className="min-h-10 flex-1"
              value={step}
              onChange={(e) => set(i, e.target.value)}
              placeholder={i === 0 ? '例: じゃがいもの皮をむいて一口大に切る' : '次の手順'}
            />
            <div className="flex flex-col">
              <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`手順${i + 1}を上へ`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`手順${i + 1}を下へ`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`手順${i + 1}を消す`} onClick={() => remove(i)}>
                <X className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" size="sm" className="self-start rounded-full" onClick={() => update([...steps, ''])} disabled={steps.length >= 30}>
        <Plus className="size-4" />
        手順を追加
      </Button>
    </fieldset>
  )
}
