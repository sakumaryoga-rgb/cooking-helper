-- v1.18.0: 分数の数量(1/3 = 0.333333 などの小数)と常備品の切り替えのテスト。合成データのみ。
-- アプリは分数を小数第6位までの数で送り、使い切るときは在庫ちょうどの量を送る(src/lib/quantity.js の snapToStock)

reset role;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000a18');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a18', false);
do $$
declare
  g groups;
  cabbage uuid;
  salt uuid;
  rec uuid;
  log1 uuid;
  log2 uuid;
  log3 uuid;
  r record;
begin
  g := create_group('分数の家');

  -- 1. キャベツ 1 個を、1/3 ずつ3回の調理で使い切る(3回目はアプリが在庫ちょうどの 0.333334 を送る)
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'キャベツ', '個', 0) returning id into cabbage;
  perform adjust_stock(cabbage, 1, true, null, null);
  insert into recipes (group_id, title, created_by) values (g.id, '回鍋肉', auth.uid()) returning id into rec;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (rec, cabbage, 0.333333);

  log1 := cook_recipe_v2(rec, jsonb_build_array(jsonb_build_object('ingredient_id', cabbage, 'quantity', 0.333333)), '22222222-2222-4222-8222-000000000001');
  log2 := cook_recipe_v2(rec, jsonb_build_array(jsonb_build_object('ingredient_id', cabbage, 'quantity', 0.333333)), '22222222-2222-4222-8222-000000000002');
  assert (select quantity from ingredients where id = cabbage) = 0.333334, '2回使って 0.333334 残る';
  log3 := cook_recipe_v2(rec, jsonb_build_array(jsonb_build_object('ingredient_id', cabbage, 'quantity', 0.333334)), '22222222-2222-4222-8222-000000000003');
  assert (select quantity from ingredients where id = cabbage) = 0, '3回目でちょうど0(端数も負数も残らない)';
  assert coalesce((select sum(quantity) from ingredient_batches where ingredient_id = cabbage), 0) = 0, 'ロットも残らない';
  assert exists (select 1 from ingredients where id = cabbage), 'レシピの材料なので食材は残る';

  -- 在庫より多く送っても在庫までしか引かない(負数にならない)
  perform cook_recipe_v2(rec, jsonb_build_array(jsonb_build_object('ingredient_id', cabbage, 'quantity', 0.5)), '22222222-2222-4222-8222-000000000004');
  assert (select quantity from ingredients where id = cabbage) = 0, '在庫0からは引かない';

  -- 取り消すと、使った分数の量がそのまま戻る
  assert undo_cook(log3), '3回目を取り消せる';
  assert (select quantity from ingredients where id = cabbage) = 0.333334, '取り消しで 0.333334 戻る';
  assert (select sum(quantity) from ingredient_batches where ingredient_id = cabbage) = 0.333334, 'ロットも戻る';

  -- 冷蔵庫の「＋」「−」と期限つき追加でも小数がそのまま入る(1/2 個)
  select * into r from adjust_stock(cabbage, 0.5, false, null, null);
  assert r.new_quantity = 0.833334, '0.5 を足す';
  select * into r from adjust_stock(cabbage, -0.833334, false, null, null);
  assert r.new_quantity = 0 and not r.deleted, '在庫ちょうどを引くと0(レシピの材料なので残る)';

  -- 2. 常備品の切り替えでは、数量もロットも変えない
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '塩', 'g', 0) returning id into salt;
  perform adjust_stock(salt, 250, true, null, null);
  update ingredients set is_staple = true where id = salt;
  assert (select quantity from ingredients where id = salt) = 250, '常備品にしても数量は残る';
  assert (select sum(quantity) from ingredient_batches where ingredient_id = salt) = 250, '常備品にしてもロットは残る';
  update ingredients set is_staple = false where id = salt;
  assert (select quantity from ingredients where id = salt) = 250 and not (select is_staple from ingredients where id = salt), '数量管理に戻すと、元の数量で再開する';

  -- 常備品(在庫0)を「作った」で引くことを選んでも、負数にも削除にもならない
  update ingredients set is_staple = true, quantity = 0 where id = salt;
  delete from ingredient_batches where ingredient_id = salt;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (rec, salt, 2);
  perform cook_recipe_v2(rec, jsonb_build_array(jsonb_build_object('ingredient_id', salt, 'quantity', 2)), '22222222-2222-4222-8222-000000000005');
  assert (select quantity from ingredients where id = salt) = 0, '常備品の在庫0からは引かない';
  assert exists (select 1 from ingredients where id = salt), '常備品は消えない';
end $$;
\echo fractions_staples.test.sql: all assertions passed
