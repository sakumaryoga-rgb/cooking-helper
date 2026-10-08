# 一般公開に向けたセキュリティ確認(v1.9.0 時点)

いずれも既存の仕組みで対応済み。DB テスト(`supabase/tests/`)が CI で毎回確かめている。

| 観点 | 仕組み | 確かめているテスト |
| --- | --- | --- |
| 食材マスタの不正な追加・変更・削除 | 共通の品目はクライアントから変更不可、家庭専用は自分の家庭だけ(migration 013) | catalog.test.sql、inventory.test.sql 7 |
| 家族グループ間のデータ分離 | 全テーブルの RLS(`my_group_id()`)、RPC での所属確認 | inventory・catalog・cooking・expiry・recipe_import の各テスト |
| 招待リンクの期限と失効 | 7日で期限切れ、再発行で前のリンクを失効、無効化、ハッシュ保存、失敗10回/時の制限(010) | invites.test.sql |
| お問い合わせのスパム対策 | 10分3件・1日10件、同じ本文は1日1回、隠し欄・3秒未満は保存しない、本人も読めない(016) | launch.test.sql |
| 管理画面の権限・レート制限 | DB 側で運営者を確認、無効化に対応、運営者以外は1時間5回で締め出し(016、018) | launch.test.sql、operations.test.sql |
| 秘密情報の露出 | service_role 鍵・通知先は VITE_ なしのサーバー専用環境変数。配信物に含まれないことをビルドで確認 | (v1.9.0 で配信物を検索して0件) |
| Preview から本番 DB に接続しない | ビルド時に本番の接続先を外す(runtimeEnv)、Function は Production 以外で何もしない | telemetry.disabled.test、api のテスト |

重大な問題は見つからなかった。一般公開の前に検討したいこと(今回は対象外):

- お問い合わせのボット対策を強める(Cloudflare Turnstile など。外部サービスの登録が必要)。
- Supabase Auth のメール送信のレート制限と、独自 SMTP の送信上限の確認(ダッシュボードの設定)。
- 旧機能の削除(`docs/legacy-removal.md`)。
