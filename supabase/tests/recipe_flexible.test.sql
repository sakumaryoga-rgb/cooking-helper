-- migration 024(分量が分からない・食材が未確定の材料の保存、家庭ごとの分量の換算)のテスト。合成データのみ
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000ee101'),  -- W: W家
  ('00000000-0000-4000-8000-0000000ee102');  -- X: X家(他人)

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

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ee102', false);
do $$
declare g groups;
begin
  g := create_group('X家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'Xの豚肉', 'g', 500);
  perform set_config('test.x_pork', (select id::text from ingredients where name = 'Xの豚肉'), false);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ee101', false);
do $$
declare
  g groups;
  pork uuid;
  salt uuid;
  r uuid;
  n int;
  n_tofu uuid;
begin
  g := create_group('W家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '豚こま切れ肉', 'g', 300) returning id into pork;
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '塩', 'g', 100) returning id into salt;
  insert into recipes (group_id, title) values (g.id, '豚丼') returning id into r;
  perform set_config('test.r', r::text, false);
  perform set_config('test.pork', pork::text, false);
  perform set_config('test.salt', salt::text, false);

  -- 数が分からない分量(元の表記を残す)・確認待ちの材料(食材は空、元の名前を残す)を保存できる
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, amount_text, note)
  values (r, pork, null, '1パック', '冷凍');
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, amount_text, source_name)
  values (r, null, null, '1/2丁', '豆腐');
  assert (select count(*) from recipe_ingredients where recipe_id = r) = 2;
  -- 食材も元の名前もない行は作れない
  assert pg_temp.err(format('insert into recipe_ingredients (recipe_id) values (%L)', r)) like '%recipe_ingredients_target_present%';
  -- 分量は空か0より大きい数
  assert pg_temp.err(format('insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (%L, %L, 0)', r, salt)) like '%required_quantity%';

  -- update_recipe: 数の分からない分量・確認待ちの行を受け付け、同じ食材は1つにまとめる(1つでも数が空なら合計も空)
  perform update_recipe(r, '豚丼', null, null, null, null, jsonb_build_array(
    jsonb_build_object('ingredient_id', pork, 'required_quantity', 200, 'amount_text', '200g'),
    jsonb_build_object('ingredient_id', pork, 'required_quantity', null, 'amount_text', '少々'),
    jsonb_build_object('ingredient_id', salt, 'required_quantity', null, 'amount_text', '少々', 'note', '粗塩'),
    jsonb_build_object('ingredient_id', null, 'source_name', '豆腐', 'amount_text', '1/2丁')
  ));
  assert (select count(*) from recipe_ingredients where recipe_id = r) = 3;
  assert (select required_quantity from recipe_ingredients where recipe_id = r and ingredient_id = pork) is null;
  assert (select amount_text from recipe_ingredients where recipe_id = r and ingredient_id = pork) = '200g + 少々';
  assert (select note from recipe_ingredients where recipe_id = r and ingredient_id = salt) = '粗塩';
  assert (select source_name from recipe_ingredients where recipe_id = r and ingredient_id is null) = '豆腐';
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L)', r, 'x', jsonb_build_array(jsonb_build_object('amount_text', '1個')))) = '材料の名前がありません';
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L)', r, 'x',
    jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.x_pork'), 'required_quantity', 1)))) = 'この家にない食材は材料にできません';

  -- 確認待ちの行を、あとで食材に決める(直接の更新。選んでいる家のレシピだけ)。
  -- 同じ食材の行が既にあると一意制約で失敗する(アプリは確認待ちの行を消してまとめる)
  begin
    update recipe_ingredients set ingredient_id = salt, source_name = null where recipe_id = r and ingredient_id is null and source_name = '豆腐';
    assert false, '同じ食材の行は二重にできない';
  exception when unique_violation then null;
  end;
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '木綿豆腐', '丁', 1) returning id into n_tofu;
  update recipe_ingredients set ingredient_id = n_tofu, source_name = null where recipe_id = r and ingredient_id is null and source_name = '豆腐';
  get diagnostics n = row_count;
  assert n = 1, '確認待ちの行を食材に決められる';
end $$;

-- 調理: アプリは確定した数量だけを渡す。旧 cook_recipe も、数が空の行・食材が空の行で在庫を減らさない
do $$
begin
  perform cook_recipe(current_setting('test.r')::uuid, '{}'::jsonb);
  assert (select quantity from ingredients where id = current_setting('test.pork')::uuid) = 300, '数が分からない分量は推測で減らさない';
  assert (select quantity from ingredients where id = current_setting('test.salt')::uuid) = 100;
  perform cook_recipe_v2(current_setting('test.r')::uuid, jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.pork'), 'quantity', 200)), gen_random_uuid());
  assert (select quantity from ingredients where id = current_setting('test.pork')::uuid) = 100, '入れた量だけ減らす';
end $$;

-- 家庭ごとの分量の換算(1パック = 200g)
do $$
begin
  insert into ingredient_unit_conversions (ingredient_id, unit, amount) values (current_setting('test.pork')::uuid, 'パック', 200);
  update ingredient_unit_conversions set amount = 250 where ingredient_id = current_setting('test.pork')::uuid and unit = 'パック';
  assert (select amount from ingredient_unit_conversions where ingredient_id = current_setting('test.pork')::uuid and unit = 'パック') = 250;
  assert pg_temp.err(format('insert into ingredient_unit_conversions (ingredient_id, unit, amount) values (%L, %L, 0)', current_setting('test.salt'), 'つまみ')) like '%amount_range%';
  -- 他の家の食材には換算を付けられない
  begin
    insert into ingredient_unit_conversions (ingredient_id, unit, amount) values (current_setting('test.x_pork')::uuid, 'パック', 200);
    assert false, '他の家の食材の換算は作れない';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 他の家の人(X)は、W家の換算を読めず、変えられない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ee102', false);
do $$
declare n int;
begin
  assert (select count(*) from ingredient_unit_conversions) = 0, '他の家の換算は見えない';
  update ingredient_unit_conversions set amount = 1;
  get diagnostics n = row_count;
  assert n = 0;
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L)', current_setting('test.r'), '乗っ取り',
    jsonb_build_array(jsonb_build_object('source_name', '豆腐')))) = '権限がありません';
end $$;

-- 食材を消すと換算も消える
reset role;
do $$
begin
  delete from ingredients where id = current_setting('test.pork')::uuid;
  assert not exists (select 1 from ingredient_unit_conversions where ingredient_id = current_setting('test.pork')::uuid);
end $$;
select set_config('request.headers', '', false);

\echo 'recipe_flexible.test.sql: all assertions passed'
