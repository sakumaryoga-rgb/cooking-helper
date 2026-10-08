# 規約・プライバシーポリシーの正式公開チェックリスト

文面は `src/routes/Legal.jsx`、確定項目は `src/lib/legal.js` の `LEGAL_INFO`。
`LEGAL_INFO` に null が残っている間は、画面に【未確定】と出て、正式版にならない。

## 運営者が決めて記入する項目

| 項目 | `LEGAL_INFO` | 決めること |
| --- | --- | --- |
| 運営者名 | `operatorName` | 個人名・屋号・法人名のどれを出すか |
| 連絡先 | `contactEmail` | 公開してよいメールアドレス(アプリ内のお問い合わせも併用) |
| 住所の扱い | `addressPolicy` | 住所を載せるか、「請求があれば遅滞なく開示します」とするか |
| 責任の上限 | `liabilityCap` | 無料サービスとしての上限(例: 利用料金の総額、一定額) |
| 合意管轄 | `court` | 第一審の専属的合意管轄裁判所 |
| データの保存地域 | `dataRegion` | Supabase のプロジェクトのリージョン(Project Settings で確認) |
| 施行日 | `effectiveDate` | 正式版を施行する日 |

## 文面で確認してほしい点

- 外部サービス: Supabase(DB・ログイン)、Vercel(配信・サーバー処理)、Notion(お問い合わせの対応管理)。
- お問い合わせと削除依頼の受付: アプリ内の「お問い合わせ」と、上の連絡先。本人確認のうえで対応。
- 収集項目・保存期間は `docs/privacy-data-inventory.md` と一致させる。
- 法務の観点での確認(専門家のレビュー)。

## 正式版への切り替え(承認後)

1. `LEGAL_INFO` をすべて埋め、`OFFICIAL = true`、`VERSION` を正式な版(例: `'2026-11-01'`)にして PR を出す。
2. 本番デプロイ後、Vercel の本番環境変数 `VITE_CONSENT_REQUIRED=true` を設定して再デプロイする。
   既存の利用者を含め、次回の利用時に同意画面が出る。同意の記録は `user_consents`。
3. 改定するときは `VERSION` を上げる。全員に「改定しました」の同意画面が出る。
