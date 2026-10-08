#!/usr/bin/env bash
# 本番 Supabase のバックアップを pg_dump で取得し、ローカルの一時 PostgreSQL に復元して
# 件数とスキーマを本番と照合する。手順の背景は docs/db-backup-restore.md を参照。
#
# - 本番への接続は読み取りのみ(pg_dump と、read only トランザクション内の SELECT)。
# - 接続文字列は画面に表示しない非表示入力で受け取り、ファイルやログには書かない。
# - バックアップと検証結果は ~/cookdoor-backups(権限 700、ファイルは 600)に保存する。
# - 復元先はこのスクリプトが作る専用の一時クラスタ(専用ポート)で、既存のローカルDBには触れない。
# - 一時クラスタは削除せず停止して残す。削除するかは検証結果を見てから決める。
#
# 使い方: bash scripts/backup-and-verify.sh
set -euo pipefail
umask 077

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PATH="$PG_BIN:$PATH"
BACKUP_DIR="${BACKUP_DIR:-$HOME/cookdoor-backups}"
RESTORE_PORT="${RESTORE_PORT:-54371}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

for cmd in pg_dump pg_restore psql initdb pg_ctl createdb; do
  command -v "$cmd" >/dev/null || { echo "中止: $cmd が見つかりません(brew install postgresql@17)" >&2; exit 1; }
done
if lsof -nP -iTCP:"$RESTORE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "中止: ポート $RESTORE_PORT が使用中です。RESTORE_PORT を変えて実行してください" >&2
  exit 1
fi

printf '本番DBの接続文字列(Supabase の Connect → Session pooler)を貼り付けて Enter(画面には表示されません): ' >&2
IFS= read -rs DB_URL
echo >&2
if [[ "$DB_URL" != postgres://* && "$DB_URL" != postgresql://* ]]; then
  echo "中止: 接続文字列の形式ではありません" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
dump="$BACKUP_DIR/cookdoor-$stamp.dump"
report="$BACKUP_DIR/cookdoor-$stamp.report.txt"
work="$BACKUP_DIR/restore-check-$stamp"
mkdir -p "$work"

log() { printf '%s\n' "$*" | tee -a "$report" >&2; }

# 件数とスキーマの指紋。本番と復元先で同じSQLを実行して比べる。
read -r -d '' FINGERPRINT_SQL <<'SQL' || true
begin transaction read only;
select 'count ' || t || ' ' || n from (
  select 'groups' t, count(*) n from public.groups union all
  select 'group_members', count(*) from public.group_members union all
  select 'ingredients', count(*) from public.ingredients union all
  select 'ingredient_batches', count(*) from public.ingredient_batches union all
  select 'recipes', count(*) from public.recipes union all
  select 'recipe_ingredients', count(*) from public.recipe_ingredients union all
  select 'ingredient_catalog', count(*) from public.ingredient_catalog
) c order by 1;
select 'table ' || relname || ' rls=' || relrowsecurity::text || ' replident=' || relreplident::text
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;
select 'policy ' || tablename || ' ' || policyname || ' ' || cmd from pg_policies where schemaname = 'public' order by 1;
select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> '
       || pg_get_function_result(p.oid) || ' secdef=' || p.prosecdef::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1;
select 'index ' || indexname from pg_indexes where schemaname = 'public' order by 1;
select 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || contype::text
  from pg_constraint where connamespace = 'public'::regnamespace order by 1;
select 'publication ' || tablename from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
commit;
SQL

log "COOKDOOR バックアップと復元検証 $stamp"
log "PostgreSQL クライアント: $(pg_dump --version)"

log ""
log "== 1. 本番の件数とスキーマ(読み取りのみ)"
psql "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FINGERPRINT_SQL" > "$work/prod.txt"
log "本番の項目数: $(wc -l < "$work/prod.txt" | tr -d ' ')"

log ""
log "== 2. pg_dump(public と auth、custom 形式)"
pg_dump "$DB_URL" -Fc -n public -n auth -f "$dump"
chmod 600 "$dump"
size=$(stat -f %z "$dump")
log "ファイル: $dump"
log "サイズ: $size バイト"
log "SHA-256: $(shasum -a 256 "$dump" | cut -d' ' -f1)"
log "形式: $(pg_restore --list "$dump" | grep -m1 'Format:' | sed -E 's/^;[[:space:]]+//')"
log "収録オブジェクト数: $(pg_restore --list "$dump" | grep -cvE '^;|^$')"

# 復元先の auth.users に入れるための id だけを本番から取る(メール等は取らない)
psql "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -c "begin transaction read only; select id from auth.users order by id; commit;" > "$work/user_ids.txt"
unset DB_URL

log ""
log "== 3. ローカルの一時クラスタへ復元(ポート ${RESTORE_PORT}、本番には接続しない)"
initdb -D "$work/pgdata" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$work/pgdata" -l "$work/postgres.log" -w \
  -o "-p $RESTORE_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null
export PGHOST=127.0.0.1 PGPORT="$RESTORE_PORT" PGUSER=postgres
trap 'pg_ctl -D "$work/pgdata" -m fast stop >/dev/null 2>&1 || true' EXIT

createdb cookdoor_restore
psql -X -q -v ON_ERROR_STOP=1 -d cookdoor_restore -f "$REPO_DIR/supabase/tests/shim.sql"
psql -X -q -v ON_ERROR_STOP=1 -d cookdoor_restore -c "copy auth.users (id) from stdin" < "$work/user_ids.txt"
rm -f "$work/user_ids.txt"

# Supabase 固有のロールや拡張に関する警告は出うるので、エラーは数えて内容を記録する
set +e
pg_restore -d cookdoor_restore --no-owner --no-privileges -n public "$dump" 2> "$work/restore-errors.log"
restore_status=$?
set -e
error_count=$(grep -c 'error:' "$work/restore-errors.log" || true)
log "pg_restore 終了コード: ${restore_status}、エラー行: $error_count"
if [[ "$error_count" -gt 0 ]]; then
  log "エラーの内容(先頭20行):"
  grep 'error:' "$work/restore-errors.log" | head -20 | tee -a "$report" >&2
fi

psql -X -q -A -t -v ON_ERROR_STOP=1 -d cookdoor_restore -c "$FINGERPRINT_SQL" > "$work/restored.txt"

log ""
log "== 4. 照合"
# Realtime のパブリケーション登録は、スキーマを絞った pg_dump(-n)には収録されない仕様なので
# 照合から外し、本番の登録内容をレポートに残す(復旧時は migrations の alter publication で戻す)。
grep -v '^publication ' "$work/prod.txt" > "$work/prod.cmp" || true
grep -v '^publication ' "$work/restored.txt" > "$work/restored.cmp" || true
log "Realtime の配信対象(本番。バックアップには含まれない): $(grep '^publication ' "$work/prod.txt" | sed 's/^publication //' | tr '\n' ' ')"
if diff -u "$work/prod.cmp" "$work/restored.cmp" > "$work/diff.txt"; then
  log "件数とスキーマ: 一致"
  verdict="合格"
else
  log "件数とスキーマ: 不一致(差分は $work/diff.txt)"
  head -40 "$work/diff.txt" | tee -a "$report" >&2
  verdict="不合格"
fi
log ""
log "件数(本番):"
grep '^count ' "$work/prod.txt" | tee -a "$report" >&2
log ""
log "判定: $verdict"
log "一時クラスタ: $work/pgdata(停止して残しています。不要になったら削除してください)"
[[ "$verdict" == "合格" ]]
