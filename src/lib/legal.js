// 利用規約・プライバシーポリシーの確定項目と版。
// 改定するときは VERSION を上げる(全員に「改定しました」の同意画面が出る)。docs/legal-checklist.md
export const LEGAL_INFO = {
  operatorName: '個人開発(ryogasakuma)',
  contact: 'アプリ内の「お問い合わせ」フォーム',
  addressPolicy: '請求があれば遅滞なく開示します',
  court: '運営者の所在地を管轄する日本の裁判所',
  dataRegion: '日本(東京)',
  effectiveDate: '2026-10-11',
}

const VERSION = '2026-10-11'

export const LEGAL_STATUS = 'official'
export const LEGAL_VERSIONS = { terms: VERSION, privacy: VERSION }
// 同意は、初めて開いたとき(ログインの前)に求める
export const CONSENT_REQUIRED = true

export function legalValue(key) {
  return LEGAL_INFO[key]
}
