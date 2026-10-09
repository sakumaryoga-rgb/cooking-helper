-- migration 023(自分で考えたレシピ・レシピのカスタマイズ)のテスト。合成データのみ
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000cc001'),  -- S: S家
  ('00000000-0000-4000-8000-0000000cc002');  -- T: T家(他人)

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

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000cc002', false);
do $$
declare g groups;
begin
  g := create_group('T家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'Tの豚肉', 'g', 300);
  perform set_config('test.t_pork', (select id::text from ingredients where name = 'Tの豚肉'), false);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000cc001', false);
do $$
declare
  g groups;
  egg uuid;
  onion uuid;
  r uuid;
begin
  g := create_group('S家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'Sの卵', '個', 6) returning id into egg;
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'Sの玉ねぎ', '個', 2) returning id into onion;
  -- 自分で考えたレシピ(URL なし)を作り方・メモ・絵つきで保存する
  insert into recipes (group_id, title, instructions, memo, icon, servings)
  values (g.id, 'わが家のオムレツ', '1. 卵を溶く' || chr(10) || '2. 焼く', '甘めが好き', '🍳', 2) returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, egg, 3);
  perform set_config('test.r', r::text, false);
  perform set_config('test.egg', egg::text, false);
  perform set_config('test.onion', onion::text, false);

  -- カスタマイズ: 名前・人数・作り方・メモ・絵・材料をまとめて差し替える(同じ食材は合算)
  perform update_recipe(r, ' ふわとろオムレツ ', 3, '  卵を3個溶いて焼く  ', '', '🥚',
    jsonb_build_array(
      jsonb_build_object('ingredient_id', egg, 'required_quantity', 2),
      jsonb_build_object('ingredient_id', egg, 'required_quantity', 1.5),
      jsonb_build_object('ingredient_id', onion, 'required_quantity', 0.5, 'raw_text', '玉ねぎ 1/2個')));
  assert (select title from recipes where id = r) = 'ふわとろオムレツ';
  assert (select servings from recipes where id = r) = 3;
  assert (select instructions from recipes where id = r) = '卵を3個溶いて焼く';
  assert (select memo from recipes where id = r) is null, '空のメモは消す';
  assert (select icon from recipes where id = r) = '🥚';
  assert (select required_quantity from recipe_ingredients where recipe_id = r and ingredient_id = egg) = 3.5, '同じ食材は合算';
  assert (select count(*) from recipe_ingredients where recipe_id = r) = 2;

  -- 失敗したら何も変わらない(他の家の食材・分量なし・材料なし・空の名前)
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L)', r, '乗っ取り',
    jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.t_pork'), 'required_quantity', 1)))) = 'この家にない食材は材料にできません';
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L)', r, 'x',
    jsonb_build_array(jsonb_build_object('ingredient_id', egg, 'required_quantity', 0)))) = '材料の分量を入れてください';
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L)', r, 'x', '[]')) = '材料を1つ以上入れてください';
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L)', r, '  ',
    jsonb_build_array(jsonb_build_object('ingredient_id', egg, 'required_quantity', 1)))) like '料理名を入力してください%';
  assert (select title from recipes where id = r) = 'ふわとろオムレツ', '失敗した変更は残らない';
  assert (select count(*) from recipe_ingredients where recipe_id = r) = 2;

  -- 長すぎる作り方は DB が拒否する
  assert pg_temp.err(format('select update_recipe(%L, %L, null, %L, null, null, %L)', r, 'x', repeat('あ', 4001),
    jsonb_build_array(jsonb_build_object('ingredient_id', egg, 'required_quantity', 1)))) like '%recipes_instructions_length%';
end $$;

-- 他の家の人(T)は、S家のレシピを変更できない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000cc002', false);
do $$
begin
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L)', current_setting('test.r'), '乗っ取り',
    jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.t_pork'), 'required_quantity', 1)))) = '権限がありません';
end $$;
reset role;
do $$
begin
  assert (select title from recipes where id = current_setting('test.r')::uuid) = 'ふわとろオムレツ';
end $$;

-- 調理と取り消しは、カスタマイズ後の材料で動く
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000cc001', false);
do $$
declare log uuid;
begin
  log := cook_recipe_v2(current_setting('test.r')::uuid,
    jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.egg'), 'quantity', 3.5),
                      jsonb_build_object('ingredient_id', current_setting('test.onion'), 'quantity', 0.5)), gen_random_uuid());
  assert (select quantity from ingredients where id = current_setting('test.egg')::uuid) = 2.5;
  perform undo_cook(log);
  assert (select quantity from ingredients where id = current_setting('test.egg')::uuid) = 6;
end $$;
reset role;

\echo 'recipe_custom.test.sql: all assertions passed'
