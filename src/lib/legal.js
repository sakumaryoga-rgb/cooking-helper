// 利用規約・プライバシーポリシーの版と、同意画面を出すかどうか。
// 文面は公開前のレビュー用ドラフト。正式公開(同意画面の有効化)は運営者の承認後に、
// Vercel の環境変数 VITE_CONSENT_REQUIRED=true を設定して行う。版を上げると、全員に同意画面が再び出る。
export const LEGAL_VERSIONS = { terms: 'draft-2026-10-08', privacy: 'draft-2026-10-08' }
export const LEGAL_STATUS = 'draft'
export const CONSENT_REQUIRED = import.meta.env.VITE_CONSENT_REQUIRED === 'true'
// 未確定の項目(推測で埋めない)
export const UNDECIDED = '【未確定】'
