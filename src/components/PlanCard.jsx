import { BookOpen, Check, Clock, Refrigerator, Sparkles, Users } from 'lucide-react'

// プラン: いま使える機能(すべて無料)と、今後の予定(準備中)を分けて示す。
// 申し込み・購入のボタンは置かない(有料プランを契約できると誤解させない)。
// 有料プランや広告を始めるときは、PLANNED の内容と注記をここで差し替える
const AVAILABLE = [
  { icon: Refrigerator, text: '冷蔵庫の在庫と期限の管理' },
  { icon: BookOpen, text: 'レシピの取り込み・オリジナルレシピ' },
  { icon: Users, text: '家族との共有・複数の家' },
]
const PLANNED = [
  { title: '広告の表示', text: '無料で使い続けられるように、画面の一部に広告を出す予定です' },
  { title: '有料プラン', text: '広告なし・便利な追加機能を検討中です。内容と料金は決まっていません' },
]

export function PlanCard() {
  return (
    <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="plan-title">
      <div className="flex items-center gap-3 bg-gradient-to-br from-primary/30 to-primary/5 px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <div className="flex-1">
          <h2 id="plan-title" className="text-base font-semibold">
            プラン
          </h2>
          <p className="text-xs text-muted-foreground">いまはすべての機能を無料で使えます</p>
        </div>
        <span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold">無料</span>
      </div>

      <div className="flex flex-col gap-4 px-4 py-3">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">いま使える機能</p>
          <ul className="flex flex-col gap-1.5">
            {AVAILABLE.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2 text-sm">
                <Check className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-dashed p-3" aria-label="今後の予定">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Clock className="size-3.5" aria-hidden="true" />
            今後の予定(準備中・まだ使えません)
          </p>
          <ul className="flex flex-col gap-2">
            {PLANNED.map((p) => (
              <li key={p.title} className="text-sm text-muted-foreground">
                <span className="mr-1.5 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium">準備中</span>
                <span className="font-medium text-foreground/70">{p.title}</span>
                <p className="mt-0.5 text-xs">{p.text}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-muted-foreground">
          現在、有料プランのお申し込みはできません。始めるときは、内容と料金をアプリでお知らせします
        </p>
      </div>
    </section>
  )
}
