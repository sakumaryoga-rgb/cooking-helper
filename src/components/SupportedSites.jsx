import { SUPPORTED_SITES } from '@/lib/recipeImport/sites'

// 取り込みに対応しているレシピサービスの一覧。各社の公式ロゴは使わず、名前とイメージカラーの頭文字で示す
// (ロゴの利用許諾がないため。提携・公認と誤解されないよう、注記を必ず添える)
function initialOf(name) {
  return [...name.replace(/^NHK\s*/, '')][0]
}

export function SiteChip({ site, active = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pl-1 pr-2.5 text-xs transition-all ${
        active ? 'border-transparent shadow-md ring-2 ring-offset-1' : 'text-foreground/80'
      }`}
      style={active ? { '--tw-ring-color': site.color } : undefined}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: site.color }} aria-hidden="true">
        {initialOf(site.name)}
      </span>
      {site.name}
    </span>
  )
}

export function SupportedSites({ activeId }) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="取り込みに対応しているレシピサービス">
        {SUPPORTED_SITES.map((site) => (
          <li key={site.id}>
            <SiteChip site={site} active={site.id === activeId} />
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        各サービスのレシピページの URL から、料理名・材料・分量・人数を読み込みます。COOKDOOR は各サービスと提携していません。サービス名は各社の商標または登録商標です
      </p>
    </div>
  )
}
