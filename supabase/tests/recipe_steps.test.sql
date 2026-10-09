-- migration 025(オリジナルレシピの手順ごとの材料と量)のテスト。合成データのみ
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000ff101'),  -- Y: Y家
  ('00000000-0000-4000-8000-0000000ff102');  -- Z: Z家(他人)

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

set role authenticated;
select set_config('request.headers', '', false);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff102', false);
select create_group('Z家');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff101', false);
do $$
declare
  g groups;
  onion uuid;
  beef uuid;
  r uuid;
  items jsonb;
begin
  g := create_group('Y家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '玉ねぎ', '個', 3) returning id into onion;
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '牛こま切れ肉', 'g', 500) returning id into beef;
  insert into recipes (group_id, title) values (g.id, '牛丼') returning id into r;
  perform set_config('test.r', r::text, false);
  perform set_config('test.onion', onion::text, false);
  perform set_config('test.beef', beef::text, false);
  items := jsonb_build_array(
    jsonb_build_object('ingredient_id', onion, 'required_quantity', 1),
    jsonb_build_object('ingredient_id', beef, 'required_quantity', 200),
    jsonb_build_object('source_name', 'たれ', 'amount_text', '適量'));
  perform set_config('test.items', items::text, false);

  -- 手順ごとの材料と量。同じ材料を複数の手順で使える(合計 2個 はレシピの 1個 と違うが、そのまま保存する)
  perform update_recipe(r, '牛丼', 2, null, null, null, items, jsonb_build_array(
    jsonb_build_object('text', '玉ねぎを切る', 'uses', jsonb_build_array(jsonb_build_object('ingredient_id', onion, 'quantity', 1))),
    jsonb_build_object('text', '肉と玉ねぎを炒める', 'uses', jsonb_build_array(
      jsonb_build_object('ingredient_id', beef, 'quantity', 200), jsonb_build_object('ingredient_id', onion, 'quantity', 1))),
    jsonb_build_object('text', 'たれを加える', 'uses', jsonb_build_array(jsonb_build_object('source_name', 'たれ'))),
    jsonb_build_object('text', '盛り付ける', 'uses', '[]'::jsonb)
  ));
  assert jsonb_array_length((select steps from recipes where id = r)) = 4;
  assert (select required_quantity from recipe_ingredients where recipe_id = r and ingredient_id = onion) = 1, 'レシピの分量は手順の合計で変えない';

  -- 手順で使えるのは、このレシピの材料だけ
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L, %L)', r, '牛丼', items,
    jsonb_build_array(jsonb_build_object('text', 'x', 'uses', jsonb_build_array(jsonb_build_object('ingredient_id', gen_random_uuid())))))) = '手順で使う材料は、このレシピの材料から選んでください';
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L, %L)', r, '牛丼', items,
    jsonb_build_array(jsonb_build_object('text', 'x', 'uses', jsonb_build_array(jsonb_build_object('source_name', '知らない材料')))))) = '手順で使う材料は、このレシピの材料から選んでください';
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L, %L)', r, '牛丼', items,
    jsonb_build_array(jsonb_build_object('text', 'x', 'uses', jsonb_build_array(jsonb_build_object('ingredient_id', onion, 'quantity', 0)))))) = '手順で使う材料は、このレシピの材料から選んでください';
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L, %L)', r, '牛丼', items, '{"text":"x"}')) = '手順の形が正しくありません';
  assert jsonb_array_length((select steps from recipes where id = r)) = 4, '失敗した変更は残らない';

  -- 手順を渡さない(v1.16.0 の名前付き7引数・URL のレシピの編集)なら、手順の記録は変えない
  perform update_recipe(p_recipe_id => r, p_title => '牛丼(改)', p_servings => 2, p_instructions => null, p_memo => null, p_icon => null, p_items => items);
  assert jsonb_array_length((select steps from recipes where id = r)) = 4;
  assert (select title from recipes where id = r) = '牛丼(改)';
  -- 空の手順を渡すと消える
  perform update_recipe(r, '牛丼(改)', 2, null, null, null, items, '[]'::jsonb);
  assert (select steps from recipes where id = r) is null;
end $$;

-- 他の家の人(Z)は、Y家のレシピの手順を変えられない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff102', false);
do $$
begin
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L, %L)', current_setting('test.r'), '乗っ取り',
    jsonb_build_array(jsonb_build_object('source_name', 'x')), '[]')) = '権限がありません';
end $$;

-- 調理: 在庫はレシピの材料の分量(アプリが渡した数量)だけで減る。手順の量では減らさない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff101', false);
do $$
begin
  perform update_recipe(current_setting('test.r')::uuid, '牛丼', 2, null, null, null, current_setting('test.items')::jsonb, jsonb_build_array(
    jsonb_build_object('text', '切る', 'uses', jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.onion'), 'quantity', 1))),
    jsonb_build_object('text', '炒める', 'uses', jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.onion'), 'quantity', 1)))));
  perform cook_recipe(current_setting('test.r')::uuid, '{}'::jsonb);
  assert (select quantity from ingredients where id = current_setting('test.onion')::uuid) = 2, '玉ねぎはレシピの 1個 だけ減る(手順の合計 2個 では減らない)';
  assert (select quantity from ingredients where id = current_setting('test.beef')::uuid) = 300;
end $$;
reset role;
select set_config('request.headers', '', false);

\echo 'recipe_steps.test.sql: all assertions passed'
