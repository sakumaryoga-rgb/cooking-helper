# v1.2.0 リリース手順(招待トークン)

承認後に行う。v1.1.1 を先にリリースしておく(このブランチは v1.1.1 の上にある)。

## 変更

- 招待を8文字の招待コードから、32バイトのランダムなトークン(43文字)に切り替える。
- 招待リンクは `https://cookdoor.app/onboarding#invite=<トークン>`。トークンは URL のハッシュに置くので、
  サーバーやアクセスログには送られない。開いた後は URL から消す。
- DB にはトークンの SHA-256 ハッシュだけを保存する。リンクは発行した直後に1回だけ表示する。
- グループごとに有効なリンクは1つ。7日で期限切れ。発行し直すと前のリンクは使えない。無効にもできる。
- 参加の失敗は1人1時間10回まで。
- group_invites と invite_join_attempts はクライアントから直接読み書きできない(RPC のみ)。
- 既存のグループとメンバーはそのまま。
- `public/version.json` の minSupportedVersion を 1.2.0 にし、旧版のアプリに更新を強制する。

## 本番適用の順序

| 順 | 操作 | 確認 |
| --- | --- | --- |
| 1 | `supabase/manual/010_precheck.sql` → `supabase/migrations/010_invite_tokens.sql`(全文)→ `supabase/manual/010_postcheck.sql` | postcheck がすべて true、件数が precheck と同じ |
| 2 | v1.2.0 をマージして本番デプロイ、`v1.2.0` タグ | 新しいグループ画面で招待リンクを発行できる |
| 3 | 家族の端末がすべて v1.2.0 になったことを確認(`usage_reports.sql` の 4、または目視) | 1.1.x 以下が残っていない |
| 4 | `supabase/manual/011_precheck.sql` → `supabase/migrations/011_drop_legacy_invite_codes.sql`(全文)| precheck の 1 が0行。適用後、下の 011 の確認 |

1 の時点で、旧方式の招待コードでの参加は止まる(利用停止)。旧コードの値の削除は 4 で別に行う。
1 と 2 の間も、旧版のアプリはグループの表示や冷蔵庫・レシピの操作を続けられる。

```sql
-- 010 の確認(すべて true)
select to_regclass('public.group_invites') is not null as invites_table,
       not has_table_privilege('authenticated', 'public.group_invites', 'SELECT') as invites_hidden,
       not has_table_privilege('authenticated', 'public.invite_join_attempts', 'SELECT') as attempts_hidden,
       has_function_privilege('authenticated', 'public.join_group_with_invite(text)', 'EXECUTE') as join_rpc,
       not has_function_privilege('anon', 'public.join_group_with_invite(text)', 'EXECUTE') as anon_blocked,
       (select count(*) from group_members) as members_unchanged;

-- 011 の確認
select count(*) filter (where invite_code is not null) as legacy_codes_left,  -- 0
       has_column_privilege('authenticated', 'public.groups', 'invite_code', 'SELECT') as legacy_readable  -- false
from groups;
```

## データの変更

- 010: データは変更しない(テーブルと関数の追加、join_group の停止だけ)。
- 011: **groups.invite_code の値をすべて null にする**。元に戻すにはバックアップが必要。
  旧コードは 010 の時点で使えなくなっているため、値が消えても動作には影響しない。

## 切り戻し

- アプリ: v1.1.1 に Instant Rollback。ただし 010 の適用後は、v1.1.1 の旧招待コードは使えない
  (グループの表示と冷蔵庫・レシピは使える)。
- 旧方式の参加を一時的に戻す必要がある場合(011 の適用前だけ可能): `supabase/schema.sql` の
  `join_group` 関数を SQL Editor で実行し直す。

## iPhone での確認

1. 更新ダイアログで「更新する」。グループ画面が「バージョン 1.2.0」。
2. グループ画面で「招待リンクを発行」し、リンクをコピーできる。
3. 家族用の別アカウント(まだグループに入っていないもの)でリンクを開き、ログイン後に参加できる。
4. 「招待リンクを無効にする」の後は、同じリンクで参加できない。
