#!/usr/bin/env bash
# 同時操作のテスト(migration 014)。複数の psql 接続から同時に「作った」と「取り消し」を実行し、
# 在庫が負にならず、同じ request_id は1回だけ反映され、取り消しで元に戻ることを確かめる。
# run.sh から、テスト用 DB 名を引数に呼ばれる。合成データのみ。
set -euo pipefail
db="$1"
q() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -c "$1"; }

user='00000000-0000-4000-8000-0000000000ff'
q "insert into auth.users (id) values ('$user')" >/dev/null
as_user="set role authenticated; select set_config('request.jwt.claim.sub', '$user', false);"
group=$(q "$as_user select (create_group('同時の家')).id" | tail -1)
ing=$(q "insert into ingredients (group_id, name, unit, quantity) values ('$group', '豚バラ肉', 'g', 100) returning id")
q "insert into ingredient_batches (ingredient_id, quantity, added_on) values ('$ing', 100, current_date)" >/dev/null
recipe=$(q "insert into recipes (group_id, title) values ('$group', '同時調理') returning id")
items="[{\"ingredient_id\": \"$ing\", \"quantity\": 30}]"
same='33333333-3333-4333-8333-333333333333'

# 同じ request_id を4本、別々の request_id を5本、同時に送る
pids=()
for i in 1 2 3 4; do
  q "$as_user select cook_recipe_v2('$recipe', '$items', '$same')" >/dev/null & pids+=($!)
done
for i in 1 2 3 4 5; do
  q "$as_user select cook_recipe_v2('$recipe', '$items', gen_random_uuid())" >/dev/null & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done

logs=$(q "select count(*) from cook_logs where group_id = '$group'")
same_logs=$(q "select count(*) from cook_logs where group_id = '$group' and request_id = '$same'")
qty=$(q "select quantity from ingredients where id = '$ing'")
used=$(q "select sum(i.used_quantity) from cook_log_items i join cook_logs l on l.id = i.cook_log_id where l.group_id = '$group'")
batches=$(q "select coalesce(sum(quantity), 0) from ingredient_batches where ingredient_id = '$ing'")
[[ "$logs" == 6 && "$same_logs" == 1 ]] || { echo "concurrency: 記録の件数が不正 logs=$logs same=$same_logs" >&2; exit 1; }
[[ "$qty" == 0 && "$used" == 100 && "$batches" == 0 ]] || { echo "concurrency: 在庫が不正 qty=$qty used=$used batches=$batches" >&2; exit 1; }

# 全部の記録を同時に2回ずつ取り消す
pids=()
for id in $(q "select id from cook_logs where group_id = '$group'"); do
  for k in 1 2; do q "$as_user select undo_cook('$id')" >/dev/null & pids+=($!); done
done
for p in "${pids[@]}"; do wait "$p"; done

qty=$(q "select quantity from ingredients where id = '$ing'")
batches=$(q "select sum(quantity) from ingredient_batches where ingredient_id = '$ing'")
undone=$(q "select count(*) from cook_logs where group_id = '$group' and undone_at is not null")
[[ "$qty" == 100 && "$batches" == 100 && "$undone" == 6 ]] || { echo "concurrency: 取り消し後が不正 qty=$qty batches=$batches undone=$undone" >&2; exit 1; }
echo 'concurrency.sh: all assertions passed'
