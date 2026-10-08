# 運用手順(運営者・お問い合わせの通知・保存期間)

## 運営者の登録・無効化(SQL Editor、承認後に行う)

運営者は先にアプリへ一度ログインしておく(auth.users に行ができる)。

```sql
-- 追加(再度有効にする場合も同じ)
insert into app_admins (user_id, note)
select id, '運営者' from auth.users where email = '<メールアドレス>'
on conflict (user_id) do update set disabled_at = null;

-- 無効化(行は残す。いつ無効にしたかが分かる)
update app_admins set disabled_at = now()
where user_id = (select id from auth.users where email = '<メールアドレス>');

-- 一覧
select a.user_id, u.email, a.created_at, a.disabled_at from app_admins a join auth.users u on u.id = a.user_id;
```

運営者かどうかは DB の関数(`is_app_admin`、`admin_gate`)が判断する。管理画面の RPC は集計の読み取りと、
お問い合わせの対応状況・再通知だけで、各家庭の在庫・レシピは返さず、変更もしない。
運営者でない呼び出しは1時間に5回で締め出される。

## お問い合わせの通知

お問い合わせは必ず DB に保存される。送信の後にアプリが `/api/contact-notify`(Vercel Function)を呼び、
サーバーが未通知のものを取り出して通知する。同じお問い合わせは同時に2回送らない(取り出すときに印を付ける)。
失敗すると理由が管理画面に出て、10分後の次の通知で再び送る。5回失敗したら止まり、管理画面の「再通知」で戻す。
通知には受付番号・種類・受付日時だけを送り、本文と返信先のメールアドレスは送らない(内容は管理画面で見る)。
通知を起動できるのは、運営者(未通知の全件)と、お問い合わせを送った本人(10分以内の自分の未通知分だけ、migration 019)。
どちらもサーバーが Supabase Auth で本人を確かめる。未認証・偽のトークンでは何もしない。応答の送信件数は運営者にだけ返す。
通知済み・対応状況を変えられるのは、service_role(このサーバー関数)と運営者の RPC だけ。

| 方式 | 費用 | 必要な設定(Vercel の Production 環境変数) |
| --- | --- | --- |
| Slack / Discord の Incoming Webhook(推奨) | 無料 | `SUPABASE_SERVICE_ROLE_KEY`、`CONTACT_NOTIFY_WEBHOOK_URL` |
| Resend(メール) | 無料枠あり。送信元ドメインの認証が必要 | `SUPABASE_SERVICE_ROLE_KEY`、`RESEND_API_KEY`、`CONTACT_NOTIFY_EMAIL_TO`、`CONTACT_NOTIFY_EMAIL_FROM` |

`SUPABASE_SERVICE_ROLE_KEY` は Supabase の Project Settings → API の service_role key。**VITE_ を付けない**
(付けるとアプリの配信物に含まれて公開される)。設定するまでは通知されず、管理画面に「未通知」と出る。
設定後、管理画面の「今すぐ通知」で動作を確かめる。

## 保存期間(90日)と自動削除

| 記録 | 削除する関数(既存) | pg_cron が有効 | pg_cron が無効 |
| --- | --- | --- | --- |
| 画面の利用記録、エラーの記録 | `purge_usage_and_error_logs()`(migration 009) | 毎日 3:30 UTC に自動 | 手動 |
| お問い合わせの返信先 | `purge_contact_emails()`(migration 016) | 毎日 3:45 UTC に自動 | 手動 |

- 自動削除の予約は、migration 009・016 の適用時に pg_cron がすでに有効だった場合だけ登録されている。
  後から有効にした場合は、`supabase/manual/schedule_purges.sql` を1回実行すれば両方がまとめて登録される
  (予約の登録だけで、その場では削除しない)。
- 管理画面の「保存期間(90日)」に、90日を過ぎて残っている件数と自動削除の有無が出る。件数が出たら、
  表示された SQL(`select * from purge_usage_and_error_logs();` / `select purge_contact_emails();`)を SQL Editor で実行する。
  手動の場合は月に1回以上。
- お問い合わせは本文を対応記録として残し、返信先だけを消す。
