#!/usr/bin/env bash
# 空のローカル PostgreSQL に schema.sql と migrations を順に適用し、tests/*.test.sql を実行する。
# 本番の Supabase には絶対に接続しない。接続先がローカル以外なら即座に中止する。
#
# 使い方: PGHOST=localhost PGPORT=5432 PGUSER=postgres bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

host="${PGHOST:-localhost}"
case "$host" in
  localhost|127.0.0.1|::1|/*) ;;
  *) echo "中止: PGHOST=$host はローカルではありません" >&2; exit 1 ;;
esac
if [[ -n "${DATABASE_URL:-}" || "${PGHOST:-}${PGSERVICE:-}" == *supabase* ]]; then
  echo "中止: Supabase への接続設定が残っています" >&2
  exit 1
fi

db="${TEST_DB:-cookdoor_test}"
psql_run=(psql -X -q -v ON_ERROR_STOP=1 -d "$db")

dropdb --if-exists "$db"
createdb "$db"

"${psql_run[@]}" -f supabase/tests/shim.sql
"${psql_run[@]}" -f supabase/schema.sql
for f in supabase/migrations/[0-9]*.sql; do
  echo "apply $(basename "$f")"
  "${psql_run[@]}" -f "$f"
done

status=0
for t in supabase/tests/*.test.sql; do
  echo "== $(basename "$t")"
  # 結果の行は捨て、\echo と失敗時のエラーだけを表示する
  if ! "${psql_run[@]}" -o /dev/null -f "$t"; then status=1; fi
done

dropdb --if-exists "$db"
exit $status
