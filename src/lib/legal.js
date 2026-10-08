// 利用規約・プライバシーポリシーの確定項目と版。
// 運営者が LEGAL_INFO の null を埋め、OFFICIAL を true にし、版を正式なもの(例: '2026-11-01')に変えると正式版になる。
// 1つでも null が残っている間は正式版にならない(ドラフトのまま【未確定】と表示する)。
// 同意画面の有効化(正式公開)は、Vercel の本番環境変数 VITE_CONSENT_REQUIRED=true で別に行う(docs/legal-checklist.md)。
export const LEGAL_INFO = {
  operatorName: null, // 運営者名(個人名・屋号・法人名)
  contactEmail: null, // 連絡先メールアドレス(公開してよいもの)
  addressPolicy: null, // 住所の扱い(例: 「請求があれば遅滞なく開示します」または住所そのもの)
  liabilityCap: null, // 責任の上限(例: 「直近12か月に受け取った利用料金の総額」)
  court: null, // 合意管轄裁判所(例: 「東京地方裁判所」)
  dataRegion: null, // データの保存地域(Supabase のリージョン。例: 「日本(東京)」)
  effectiveDate: null, // 施行日(例: '2026-11-01')
}

const OFFICIAL = false
const VERSION = 'draft-2026-10-08'

export const UNDECIDED = '【未確定】'
export const missingLegalFields = () => Object.entries(LEGAL_INFO).filter(([, v]) => !v).map(([k]) => k)
export const LEGAL_STATUS = OFFICIAL && missingLegalFields().length === 0 ? 'official' : 'draft'
export const LEGAL_VERSIONS = { terms: VERSION, privacy: VERSION }
export const CONSENT_REQUIRED = import.meta.env.VITE_CONSENT_REQUIRED === 'true'

// 確定していれば値、していなければ【未確定】(説明つき)
export function legalValue(key, hint) {
  return LEGAL_INFO[key] ?? `${UNDECIDED}${hint}`
}
