# 利用状況とエラーの記録(v1.1.0)

## 何を記録するか

収集項目の一覧と目的は `docs/privacy-data-inventory.md`。家族向けの説明はグループ画面に1行出す
(`src/lib/telemetry/notice.js`)。

## 仕組み

| 部分 | ファイル |
| --- | --- |
| テーブル、権限、RLS、90日削除 | `supabase/migrations/009_usage_and_error_logs.sql` |
| 送信(ページビュー、エラー、間引き、失敗時の握りつぶし) | `src/lib/telemetry/telemetry.js` |
| 伏せ字 | `src/lib/telemetry/sanitize.js` |
| 画面パスの正規化 | `src/lib/telemetry/paths.js` |
| App への組み込み | `src/hooks/useTelemetry.js`、`src/App.jsx` |
| 集計クエリ | `supabase/queries/usage_reports.sql` |

- 本番DBに接続しないビルド(Preview、Development)では何も送らない。
- 未ログインの画面(ログイン画面など)のページビューとエラーは記録できない。RLS が本人確認を必要とするため。
- ページビューは、画面が 0.4 秒落ち着いてから1回数える。リダイレクト(/ → /fridge)や、
  同じ画面の再描画、React の StrictMode による二重実行は数えない。
- エラーは同じ内容(指紋)を1分に1回まで、1回の表示につき20件まで送る。
- 送信は待たず、失敗しても画面には何も出さない。オフラインのときは送らない。

## セキュリティ

- クライアントができるのは、本人の行の INSERT だけ。SELECT、UPDATE、DELETE の権限を与えていない。
- user_id と created_at は INSERT できる列から外してあり、DB の既定値(`auth.uid()`、`now()`)で決まる。
  他人へのなりすましや、日時の改ざんはできない。
- group_id は、本人の所属グループ(`my_group_id()`)か null だけを受け付ける。
- path は英小文字と / : - だけ、64文字まで。レシピの ID、クエリ文字列、メールアドレスは形式チェックで入らない。
- message は500文字、stack は2000文字まで。kind は2種類、指紋は8桁の16進数だけ。
- 集計は SQL Editor(postgres ロール)だけで行う。service_role の鍵は使わない。

## データの保持と削除

- 保存期間は90日。
- `purge_usage_and_error_logs()` が90日を超えた行を消す。クライアントからは実行できない。
- pg_cron が使える場合、migration 009 が毎日 3:30 UTC(日本時間 12:30)の自動実行を登録する。
  使えない場合は、`supabase/queries/usage_reports.sql` の 9 を月に1回以上、手動で実行する。
- グループが削除されると group_id は null になる。行は90日で消える。
- 特定のユーザーの記録を消す依頼があった場合は、SQL Editor で次を実行する(一般公開時の削除依頼の対応)。

```sql
delete from page_views where user_id = '<user id>';
delete from client_errors where user_id = '<user id>';
```

## 本番への適用手順(承認後に行う)

DB を変更するリリースなので、`docs/db-backup-restore.md` のバックアップと復元確認を先に行う。

1. `supabase/manual/009_precheck.sql` を実行し、前提の行がすべて true であることと、既存テーブルの件数を控える。
2. `supabase/migrations/009_usage_and_error_logs.sql` を全文そのまま実行する。
3. `supabase/manual/009_postcheck.sql` を実行し、すべて true、既存テーブルの件数が 1 と同じであることを確かめる。
4. pg_cron が有効なら、postcheck の末尾のコメントの1行を実行し、削除の自動実行が登録されていることを確かめる。
5. その後に v1.1.0 を本番にデプロイする。アプリより先に DB を変える
   (アプリが先だと、テーブルがないため送信が失敗し続ける。失敗しても画面には影響しない)。

### 戻し方

アプリは v1.0.1 に Instant Rollback する。DB は次で元に戻せる(記録は消える)。

```sql
select cron.unschedule('purge-usage-and-error-logs');  -- pg_cron が有効な場合だけ
drop function if exists purge_usage_and_error_logs(interval);
drop table if exists client_errors;
drop table if exists page_views;
```
