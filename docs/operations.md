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

## お問い合わせの Notion 登録(BASKETBALL STATS と同じ方式)

お問い合わせは必ず Supabase(contact_messages)に保存される。送信の後にアプリが `/api/contact-notify`(Vercel Function)を呼び、
サーバーが Notion のデータベースにページを作って、そのページ ID を `notion_page_id` に記録する(migration 020)。

- 起動できるのは、運営者(未登録の全件)と、送った本人(10分以内の自分の分だけ)。サーバーが Supabase Auth で本人を確かめる。
- 二重登録しない: 取り出すときに DB で印を付け、さらに Notion に同じ受付番号のページがあれば作らずにそのページ ID を使う。
- 失敗すると理由が管理画面に出て、10分後の次の呼び出しで再び登録する。5回失敗したら止まり、管理画面の「再送」で戻す。
- Notion に送るのは受付番号・種類・受付日時・本文・対応状況(「未対応」)。返信先のメールアドレスは送らない(管理画面で見る)。
- Notion 側で対応状況を変えても Supabase には戻らない(管理画面の対応状況とは別に管理する)。

### Notion の準備(運営者が行う。シークレットは自分の端末だけで扱う)

1. https://www.notion.so/profile/integrations で「新しいインテグレーション」を作る。種類は「内部」、ワークスペースは
   お問い合わせを管理する所(BASKETBALL STATS と同じワークスペースでもよい。データベースは別に作る)。
   機能は「コンテンツを読み取る」「コンテンツを挿入する」「ユーザー情報の読み取り(メールアドレスなし)」をオン。
2. Notion に親ページ(例:「COOKDOOR 運営」)を作り、右上の「…」→「接続」で、作った Integration を追加する。
3. 自分の端末のターミナルで(Claude Code の `!` ではなく)、データベースを作る:

```bash
cd ~/cooking-helper
read -s NOTION_API_KEY && export NOTION_API_KEY   # Integration のシークレットを貼って Enter(画面に出ない)
node scripts/notion-setup.mjs '<親ページの URL>'
unset NOTION_API_KEY
```

   「COOKDOOR お問い合わせ」データベースが親ページの下にでき、`NOTION_DATABASE_ID` と、担当者に使える人の ID が表示される。
   何度実行しても、同じ名前のデータベースがあれば作り直さない。列の名前・種類・選択肢は `api/contact-notify.js` と一致している。

### スマホへの通知

- Notion の有料プランなら: データベース右上の「⚡」(オートメーション)→ トリガー「ページが追加されたとき」→
  アクション「通知を送信」で自分を選ぶ。Notion アプリ(スマホ)に通知が届く。
- 無料プランでも: 「担当者」プロパティを作り、自分の Notion ユーザー ID を `NOTION_ASSIGNEE_USER_ID` に設定する。
  ページが作られるたびに自分が担当者に入り、Notion アプリに通知が届く。ユーザー ID は、Integration のシークレットで
  `GET https://api.notion.com/v1/users` を呼ぶと分かる(または運営者に確認してもらう)。

### Vercel の環境変数(Production だけ、Sensitive、VITE_ を付けない)

| 名前 | 値 |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の Project Settings → API Keys → Legacy API Keys の service_role |
| `NOTION_API_KEY` | Integration のシークレット |
| `NOTION_DATABASE_ID` | データベース ID |
| `NOTION_ASSIGNEE_USER_ID` | (任意)通知を受けたい人の Notion ユーザー ID |

設定後に Production を再デプロイし、テストのお問い合わせを送って、Notion にページができることと、管理画面で「Notion 登録済み」になることを確かめる。
Discord の Webhook(`CONTACT_NOTIFY_WEBHOOK_URL`)は使わなくなった。登録してあれば Vercel から削除してよい。

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
