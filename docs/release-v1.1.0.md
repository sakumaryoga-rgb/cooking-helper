# v1.1.0 リリース手順

すべてユーザーの承認後に行う。DB を先に変え、アプリを後からデプロイする。

## リリースの前提

- [ ] v1.0.1 の iPhone 実機検収が完了している(更新、ログイン維持、Safe Area、家族共有)。
- [ ] Migration 009 の本番適用、main へのマージ、本番デプロイの承認がある。
- [ ] `docs/db-backup-restore.md` のバックアップと復元確認(DB を変更するリリースのため。CLAUDE.md の規則)。
- [ ] PR #3 の最新コミットで CI と Vercel のチェックが成功している。

## 1. Migration 009 の適用(SQL Editor)

| 順 | 実行するもの | 合格の条件 |
| --- | --- | --- |
| 1 | `supabase/manual/009_precheck.sql` | 「前提」がすべて true。「初回適用なら」が true。既存4テーブルの件数を控える |
| 2 | `supabase/migrations/009_usage_and_error_logs.sql`(全文) | エラーなく完了する。pg_cron が無効なら通知が1行出る |
| 3 | `supabase/manual/009_postcheck.sql` | 「参考」以外がすべて true。既存4テーブルの件数が 1 と同じ |
| 4 | (任意)Database → Extensions で pg_cron を有効にし、`supabase/manual/009_schedule_purge.sql` | 最後の select が1行返る |

4 を行わない場合は、`supabase/queries/usage_reports.sql` の 9 で、月に1回以上手動で削除する。

Migration 009 が作るのは page_views、client_errors、その権限・ポリシー・インデックス、
purge_usage_and_error_logs() だけ。既存のテーブル、RPC、RLS は変更しない(groups は外部キーの参照先としてだけ使う)。

## 2. アプリのリリース

1. PR #3 を Ready for review にし、最新コミットの CI と Vercel のチェックを確認する。
2. main にマージする(マージコミット)。
3. Vercel の本番デプロイの成功を確認する。
4. main のマージコミットに `v1.1.0` タグを付けて push する。

## 3. デプロイ後の最小限の確認(約10分)

1. `curl -s https://cookdoor.app/ | grep -o 'assets/index-[^"]*\.js'` が新しいファイル名になっている。
2. 確認用の端末で cookdoor.app を開き、更新ダイアログが出たら「更新する」を押す。
3. グループ画面の下部が「COOKDOOR バージョン 1.1.0」で、記録についての説明文が出ている。
4. 冷蔵庫、レシピ、グループの画面を1回ずつ開く。食材とレシピが普段どおり表示される。
5. SQL Editor で、記録が届いていることを確かめる(ID は表示しない)。

```sql
select path, app_version, count(*) from page_views
where created_at > now() - interval '15 minutes' group by path, app_version order by path;

select count(*) as errors_last_15min from client_errors
where created_at > now() - interval '15 minutes';
```

page_views に /fridge、/recipes、/group が 1.1.0 で数件ずつあれば合格。
0 件なら送信に失敗している(アプリの操作には影響しない)。次の「切り戻し」の判断に進む。

## 4. 切り戻し

| 状況 | 対応 |
| --- | --- |
| 画面の表示や操作に異常がある | Vercel で v1.0.1 の本番デプロイ(ca87aaa)に Instant Rollback する |
| 画面は正常だが記録が届かない | アプリはそのままでよい(計測が止まるだけ)。原因を調べて v1.1.1 で直す |
| Migration 009 の適用でエラーが出た | 適用は1回の実行でまとめて取り消される。アプリはデプロイしない |
| 記録をやめたい、DB を元に戻したい | アプリを v1.0.1 に戻した後、`docs/telemetry.md` の「戻し方」の SQL を実行する |

アプリだけを戻しても、page_views と client_errors は残る。v1.0.1 はこれらを使わないので問題ない。
Instant Rollback ができない場合は `docs/release-and-rollback.md` の方法B(main で revert して再デプロイ)。

## 別リリースで検討すること: サインアウトを端末単位にする

`docs/auth-session-investigation.md` の調査から。v1.1.0 には含めない。

- 変更: `Layout.jsx` のサインアウトを `supabase.auth.signOut({ scope: 'local' })` にする。
- 効果: サインアウトを押した端末だけがログアウトする。今は同じアカウントの全端末が、
  最長1時間以内にログアウト状態になる。
- 注意点: サインアウトしても、他の端末のセッションはサーバーに残る。端末をなくしたときに
  全端末をログアウトさせる手段がなくなるため、「すべての端末からログアウト」(scope: 'global')を
  グループ画面などに別に用意するかを、あわせて決める。
- 確認: DB テストは不要。単体テストで signOut に渡す引数を固定し、2台の端末で片方だけがログアウトすることを確かめる。
