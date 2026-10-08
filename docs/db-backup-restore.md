# 本番DBのバックアップと復元の確認

COOKDOOR の Supabase は Free プランのため、ダッシュボードから復元できる自動バックアップがない。
本番DBに変更を加える前(マイグレーションの適用前)には、必ずこの手順で手元にバックアップを取り、
復元できることを確かめる。

## 前提

- PostgreSQL 17 のクライアント(`brew install postgresql@17`)。サーバーが 17.6 なので、
  `pg_dump` も 17 系を使う。
- 接続文字列: Supabase ダッシュボード → Connect → Session pooler(IPv4)。パスワードは
  この会話やリポジトリに貼らず、端末の環境変数にだけ置く。
- バックアップには家族のメールアドレスなどの個人情報が含まれる。リポジトリの外
  (例: `~/cookdoor-backups/`)に置き、共有しない。`.gitignore` でも `*.dump` を除外している。

## まとめて実行する(推奨)

`scripts/backup-and-verify.sh` が、下の1と2を1回で行う。接続文字列は非表示の入力で受け取り、
バックアップ、照合レポート、復元に使った一時クラスタを `~/cookdoor-backups`(権限 700)に残す。
最後に「判定: 合格」と出れば、件数とスキーマ(テーブル、RLS、ポリシー、関数、インデックス、制約)が
本番と一致している。

```bash
bash scripts/backup-and-verify.sh
```

Realtime のパブリケーション登録は、スキーマを絞った `pg_dump -n` には含まれないため照合から外し、
本番の登録内容をレポートに記録する。復旧時は migrations の `alter publication` で戻す。

## 1. バックアップを取る(読み取りのみ)

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
read -s COOKDOOR_DB_URL && export COOKDOOR_DB_URL   # 接続文字列を貼り付けて Enter
mkdir -p ~/cookdoor-backups
stamp=$(date +%Y%m%d-%H%M)

# public スキーマ(アプリのデータ)と auth スキーマ(ログイン情報)を custom 形式で保存
pg_dump "$COOKDOOR_DB_URL" -Fc --no-owner --no-privileges \
  -n public -n auth -f ~/cookdoor-backups/cookdoor-$stamp.dump

# 比較用に、本番の件数を記録しておく
psql "$COOKDOOR_DB_URL" -X -A -t -c "
  select json_build_object(
    'groups',(select count(*) from groups),'group_members',(select count(*) from group_members),
    'ingredients',(select count(*) from ingredients),'ingredient_batches',(select count(*) from ingredient_batches),
    'recipes',(select count(*) from recipes),'recipe_ingredients',(select count(*) from recipe_ingredients),
    'ingredient_catalog',(select count(*) from ingredient_catalog))" > ~/cookdoor-backups/cookdoor-$stamp.counts.json
```

## 2. 復元できることを確かめる(ローカルのみ)

本番には復元しない。手元の空の PostgreSQL に public スキーマを復元し、件数を比べる。

```bash
# 手元の PostgreSQL を起動した状態で(例: brew services start postgresql@17)
createdb cookdoor_restore_check
psql -X -d cookdoor_restore_check -v ON_ERROR_STOP=1 -f supabase/tests/shim.sql

# 外部キーのため、auth.users の id だけを先に入れる
pg_restore -f - --data-only -n auth -t users ~/cookdoor-backups/cookdoor-$stamp.dump \
  | grep -c '' > /dev/null   # アーカイブが読めることの確認
psql "$COOKDOOR_DB_URL" -X -A -t -c "select id from auth.users" \
  | psql -X -d cookdoor_restore_check -c "copy auth.users (id) from stdin"

pg_restore -d cookdoor_restore_check --no-owner --no-privileges -n public \
  ~/cookdoor-backups/cookdoor-$stamp.dump

psql -X -A -t -d cookdoor_restore_check -c "
  select json_build_object(
    'groups',(select count(*) from groups),'group_members',(select count(*) from group_members),
    'ingredients',(select count(*) from ingredients),'ingredient_batches',(select count(*) from ingredient_batches),
    'recipes',(select count(*) from recipes),'recipe_ingredients',(select count(*) from recipe_ingredients),
    'ingredient_catalog',(select count(*) from ingredient_catalog))"
# → ~/cookdoor-backups/cookdoor-$stamp.counts.json と一致すれば復元可能

dropdb cookdoor_restore_check
```

`pg_restore` が Supabase 固有の拡張や権限について警告を出しても、件数が一致すれば
アプリのデータは復元できている。件数が一致しない、またはテーブルが作れない場合は、
そのバックアップを「復元できないバックアップ」とみなし、マイグレーションに進まない。

## 3. 本番で問題が起きたときの戻し方

- 追加だけのマイグレーションは、各ファイルに添えた「戻しのSQL」で取り消す。データの復元は不要。
- データが壊れた場合は、影響したテーブルだけをバックアップから取り出して戻す
  (`pg_restore --data-only -t <table>`)。全体の上書き復元は、家族が操作した最新の変更も
  消えるため最後の手段とし、実施前に承認を得る。
