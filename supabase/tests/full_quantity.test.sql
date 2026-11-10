-- migration 033: 在庫ゲージの満タンの量。合成データのみ
reset role;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000a33'), ('00000000-0000-4000-8000-000000000b33');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a33', false);
do $$
declare
  g groups;
  egg uuid;
  milk uuid;
  cab uuid;
  r uuid;
  log1 uuid;
  rec record;
begin
  g := create_group('ゲージの家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'ゲージ卵', '個', 0) returning id into egg;
  assert (select full_quantity from ingredients where id = egg) is null, '在庫0は満タンの量なし';

  -- 買い足し: 増やした後の総量が満タン
  perform adjust_stock(egg, 4, true, null, null);
  assert (select full_quantity from ingredients where id = egg) = 4, '4個買うと満タンは4';
  perform adjust_stock(egg, 2, true, null, null);
  assert (select full_quantity from ingredients where id = egg) = 6, '4個に2個足すと満タンは6';
  perform adjust_stock(egg, -2, false, null, null);
  assert (select quantity from ingredients where id = egg) = 4 and (select full_quantity from ingredients where id = egg) = 6, '2個使うと 4/6';

  -- 調理と取り消し: 取り消しは買い足しとみなさない(満タンは6のまま)
  insert into recipes (group_id, title) values (g.id, 'ゲージの卵焼き') returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, egg, 3);
  log1 := cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', egg, 'quantity', 3)), '33333333-3333-4333-8333-333333333333');
  assert (select quantity from ingredients where id = egg) = 1 and (select full_quantity from ingredients where id = egg) = 6, '調理で 1/6';
  assert undo_cook(log1);
  assert (select quantity from ingredients where id = egg) = 4 and (select full_quantity from ingredients where id = egg) = 6, '取り消すと 4/6 に戻る(満タンは変えない)';

  -- 満タンの量は今の在庫より小さくならない(100%を超えない)・負や0は空
  update ingredients set full_quantity = 1 where id = egg;
  assert (select full_quantity from ingredients where id = egg) = 4, '在庫より小さい満タンは在庫にそろえる';
  update ingredients set full_quantity = -5 where id = egg;
  assert (select full_quantity from ingredients where id = egg) = 4, '負の満タンも在庫にそろえる';
  -- 買い足し以外で在庫が満タンを超えたら、在庫にそろえる
  update ingredients set quantity = 7 where id = egg;
  assert (select full_quantity from ingredients where id = egg) = 7, '超えたら在庫にそろえる';

  -- 分数・小数
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'ゲージキャベツ', '玉', 0) returning id into cab;
  perform adjust_stock(cab, 0.5, true, null, null);
  perform adjust_stock(cab, 0.25, true, null, null);
  assert (select full_quantity from ingredients where id = cab) = 0.75, '½ に ¼ 足すと満タンは ¾';
  perform adjust_stock(cab, -0.25, false, null, null);
  assert (select quantity from ingredients where id = cab) = 0.5 and (select full_quantity from ingredients where id = cab) = 0.75, '¼ 使うと ½/¾';

  -- 単位が変わったら今の量を満タンにする
  update ingredients set unit = '個' where id = cab;
  assert (select full_quantity from ingredients where id = cab) = 0.5, '単位を変えると今の量が満タン';

  -- 全部使う: レシピで使う食材は行を残し(在庫0・満タンなし)、レシピの材料と調理の記録は残る
  select * into rec from adjust_stock(egg, -7, false, null, null);
  assert not rec.deleted, 'レシピで使う食材は消さない';
  assert (select quantity from ingredients where id = egg) = 0 and (select full_quantity from ingredients where id = egg) is null, '在庫0で満タンなし';
  assert exists (select 1 from recipe_ingredients where recipe_id = r and ingredient_id = egg), 'レシピの材料は残る';
  assert exists (select 1 from cook_log_items where cook_log_id = log1 and ingredient_id = egg), '調理の記録は残る';
  -- レシピで使っていない食材は冷蔵庫から消える
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'ゲージ牛乳', 'ml', 0) returning id into milk;
  perform adjust_stock(milk, 1000, true, null, null);
  select * into rec from adjust_stock(milk, -1000, false, null, null);
  assert rec.deleted and not exists (select 1 from ingredients where id = milk), '全部使うと冷蔵庫から消える';

  -- 食材をまとめる(買い足し以外の増加): 満タンは下げない
  perform adjust_stock(egg, 10, true, null, null);
  perform adjust_stock(egg, -5, false, null, null);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'ゲージたまご', '個', 0) returning id into milk;
  perform adjust_stock(milk, 2, true, null, null);
  perform merge_ingredients(egg, milk);
  assert (select quantity from ingredients where id = egg) = 7 and (select full_quantity from ingredients where id = egg) = 10, 'まとめると 7/10';
end $$;

-- 別の家の端末から補充・消費しても、家ごとに正しい(ほかの家の食材は変えられない)
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b33', false);
do $$
declare
  other uuid;
begin
  perform create_group('別の家');
  select id into other from ingredients where name = 'ゲージ卵' limit 1;
  assert other is null, 'ほかの家の食材は見えない';
end $$;

-- 再実行しても満タンの量を上書きしない
reset role;
\i supabase/migrations/033_ingredient_full_quantity.sql
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a33', false);
do $$
begin
  assert (select full_quantity from ingredients where name = 'ゲージ卵') = 10, '再実行しても満タンは10のまま';
  assert (select quantity from ingredients where name = 'ゲージ卵') = 7, '在庫も変わらない';
end $$;
\echo full_quantity.test.sql: all assertions passed
