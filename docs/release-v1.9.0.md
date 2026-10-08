# v1.9.0 リリース手順(一般公開準備の仕上げ)

承認後に行う。本番 SQL Editor で実行するのは `supabase/migrations/018_operations.sql` だけ
(列の追加と関数の置き換え。既存データの削除・大量更新はない)。011 と 017 は適用しない。

## 変更

- 管理画面: 未対応の件数、状態での絞り込み、お問い合わせごとの通知の状態と再通知、「今すぐ通知」、
  保存期間(90日)を過ぎた件数と自動削除の有無。運営者の無効化に対応。
- お問い合わせの通知: `/api/contact-notify`(Vercel Function)。設定するまでは通知しない(`docs/operations.md`)。
- 規約・ポリシー: 確定項目を `src/lib/legal.js` に集め、埋めれば正式版にできる構成(`docs/legal-checklist.md`)。
- セキュリティの確認結果: `docs/security-review.md`。

## 適用順序

1. SQL Editor で `018_operations.sql` を全文実行。
2. PR をマージして本番デプロイ、`v1.9.0` タグ。
3. (承認後)運営者の登録、通知の環境変数の設定(`docs/operations.md`)。

## 切り戻し

v1.8.0 に Instant Rollback(018 は残してよい。v1.8.0 は追加の列・関数を使わないだけで動く)。
