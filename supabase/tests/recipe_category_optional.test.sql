-- migration 028(料理カテゴリ・必須/任意の材料・今回だけ追加した食材)のテスト。合成データのみ
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000ff201'),  -- P: P家
  ('00000000-0000-4000-8000-0000000ff202');  -- Q: Q家(他人)

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
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff202', false);
do $$
declare
  g groups;
  other uuid;
begin
  g := create_group('Q家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'Q家のしめじ', 'パック', 3) returning id into other;
  perform set_config('test.other', other::text, false);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff201', false);
do $$
declare
  g groups;
  beef uuid;
  potato uuid;
  peas uuid;
  shimeji uuid;
  r uuid;
  items jsonb;
  log1 uuid;
  log2 uuid;
begin
  g := create_group('P家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '牛こま切れ肉', 'g', 0) returning id into beef;
  perform adjust_ingredient_quantity(beef, 300, true);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'じゃがいも', '個', 0) returning id into potato;
  perform adjust_ingredient_quantity(potato, 4, true);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'さやえんどう', '本', 0) returning id into peas;
  perform adjust_ingredient_quantity(peas, 10, true);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'しめじ', 'パック', 0) returning id into shimeji;
  perform adjust_ingredient_quantity(shimeji, 2, true);

  -- 既存のレシピ: カテゴリは未設定(null)、材料はすべて必須のまま
  insert into recipes (group_id, title) values (g.id, '肉じゃが') returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, beef, 200), (r, potato, 3), (r, peas, 5);
  assert (select category is null and not category_manual from recipes where id = r), '既存のレシピのカテゴリは未設定';
  assert not exists (select 1 from recipe_ingredients where recipe_id = r and optional), '既存の材料はすべて必須';
  perform set_config('test.r', r::text, false);

  -- 1. 自動の分類で保存する(利用者が選んでいないので上書きできる)
  items := jsonb_build_array(
    jsonb_build_object('ingredient_id', beef, 'required_quantity', 200),
    jsonb_build_object('ingredient_id', potato, 'required_quantity', 3),
    jsonb_build_object('ingredient_id', peas, 'required_quantity', 5, 'optional', true));
  perform update_recipe(r, '肉じゃが', 2, null, null, null, items, null, 'japanese', false);
  assert (select category = 'japanese' and not category_manual from recipes where id = r);
  assert (select optional from recipe_ingredients where recipe_id = r and ingredient_id = peas), 'さやえんどうは任意';
  assert not (select optional from recipe_ingredients where recipe_id = r and ingredient_id = beef), '牛肉は必須のまま';

  -- 2. 利用者が選んだカテゴリは、自動の分類で上書きしない
  perform update_recipe(r, '肉じゃが', 2, null, null, null, items, null, 'western', true);
  assert (select category = 'western' and category_manual from recipes where id = r);
  perform update_recipe(r, '肉じゃが', 2, null, null, null, items, null, 'japanese', false);
  assert (select category = 'western' and category_manual from recipes where id = r), '手動のカテゴリは自動で上書きしない';
  -- カテゴリを省略(古いアプリの8引数・名前付き7引数)なら変えない
  perform update_recipe(p_recipe_id => r, p_title => '肉じゃが', p_servings => 2, p_instructions => null, p_memo => null, p_icon => null, p_items => items);
  assert (select category = 'western' and category_manual from recipes where id = r);
  -- 利用者が「自動に戻す」(null を選ぶ)と、自動の分類を受け付ける
  perform update_recipe(r, '肉じゃが', 2, null, null, null, items, null, null, true);
  assert (select category is null and not category_manual from recipes where id = r);
  assert pg_temp.err(format('select update_recipe(%L, %L, 2, null, null, null, %L, null, %L, true)', r, '肉じゃが', items, '和食')) = 'カテゴリが正しくありません';

  -- 3. 古いアプリの編集(optional の指定なし)では、任意の設定を引き継ぐ
  perform update_recipe(p_recipe_id => r, p_title => '肉じゃが', p_servings => 2, p_instructions => null, p_memo => null, p_icon => null,
    p_items => jsonb_build_array(
      jsonb_build_object('ingredient_id', beef, 'required_quantity', 200),
      jsonb_build_object('ingredient_id', potato, 'required_quantity', 3),
      jsonb_build_object('ingredient_id', peas, 'required_quantity', 5)));
  assert (select optional from recipe_ingredients where recipe_id = r and ingredient_id = peas), '古いアプリの編集でも任意は消えない';
  assert pg_temp.err(format('select update_recipe(%L, %L, 2, null, null, null, %L)', r, '肉じゃが',
    jsonb_build_array(jsonb_build_object('ingredient_id', beef, 'required_quantity', 200, 'optional', 'yes')))) = '材料の必須・任意が正しくありません';

  -- 4. 作った: 必須の材料と、使うと選んだ任意の材料、今回だけ追加したしめじだけを引く(使わない任意の材料は送らない)
  log1 := cook_recipe_v2(r, jsonb_build_array(
    jsonb_build_object('ingredient_id', beef, 'quantity', 200, 'kind', 'required'),
    jsonb_build_object('ingredient_id', potato, 'quantity', 3, 'kind', 'required'),
    jsonb_build_object('ingredient_id', shimeji, 'quantity', 1, 'kind', 'extra')), '22222222-2222-4222-8222-222222222201');
  assert (select quantity from ingredients where id = beef) = 100;
  assert (select quantity from ingredients where id = potato) = 1;
  assert (select quantity from ingredients where id = peas) = 10, '使わなかった任意の材料は引かない';
  assert (select quantity from ingredients where id = shimeji) = 1, '今回だけ追加したしめじを引く';
  assert (select sum(quantity) from ingredient_batches where ingredient_id = shimeji) = 1, 'しめじのロットも減る';
  assert (select kind from cook_log_items where cook_log_id = log1 and ingredient_id = shimeji) = 'extra';
  assert not exists (select 1 from recipe_ingredients where recipe_id = r and ingredient_id = shimeji), '今回だけ追加した食材はレシピに入れない';

  -- 再送・連打は1回分だけ
  log2 := cook_recipe_v2(r, jsonb_build_array(
    jsonb_build_object('ingredient_id', beef, 'quantity', 200, 'kind', 'required'),
    jsonb_build_object('ingredient_id', shimeji, 'quantity', 1, 'kind', 'extra')), '22222222-2222-4222-8222-222222222201');
  assert log2 = log1;
  assert (select quantity from ingredients where id = beef) = 100, '再送では引かない';
  assert (select quantity from ingredients where id = shimeji) = 1;

  -- 取り消すと、今回だけ追加した食材も含めて戻る(ロットも)
  assert undo_cook(log1);
  assert (select quantity from ingredients where id = beef) = 300;
  assert (select quantity from ingredients where id = potato) = 4;
  assert (select quantity from ingredients where id = shimeji) = 2;
  assert (select sum(quantity) from ingredient_batches where ingredient_id = shimeji) = 2;
  assert not undo_cook(log1), '2回目の取り消しは何もしない';

  -- 使うと選んだ任意の材料は引く
  log1 := cook_recipe_v2(r, jsonb_build_array(
    jsonb_build_object('ingredient_id', beef, 'quantity', 200, 'kind', 'required'),
    jsonb_build_object('ingredient_id', peas, 'quantity', 5, 'kind', 'optional')), '22222222-2222-4222-8222-222222222202');
  assert (select quantity from ingredients where id = peas) = 5;
  assert (select kind from cook_log_items where cook_log_id = log1 and ingredient_id = peas) = 'optional';

  -- レシピの材料でない食材を、必須・任意として送れない(今回だけの追加は extra で送る)
  assert pg_temp.err(format('select cook_recipe_v2(%L, %L, %L)', r,
    jsonb_build_array(jsonb_build_object('ingredient_id', shimeji, 'quantity', 1, 'kind', 'required')), gen_random_uuid())) = 'このレシピの材料ではありません';
  assert pg_temp.err(format('select cook_recipe_v2(%L, %L, %L)', r,
    jsonb_build_array(jsonb_build_object('ingredient_id', beef, 'quantity', 1, 'kind', 'bonus')), gen_random_uuid())) = '材料の指定が正しくありません';
  assert pg_temp.err(format('select cook_recipe_v2(%L, %L, %L)', r,
    jsonb_build_array(jsonb_build_object('ingredient_id', beef, 'quantity', -1, 'kind', 'required')), gen_random_uuid())) = '材料の指定が正しくありません';
  -- 他の家の食材は、今回だけの追加にもできない(在庫は変わらない)
  assert pg_temp.err(format('select cook_recipe_v2(%L, %L, %L)', r,
    jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.other'), 'quantity', 1, 'kind', 'extra')), gen_random_uuid())) = '権限がありません';
  -- kind のない古いアプリの送り方も、従来どおり動く
  log2 := cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', potato, 'quantity', 1)), gen_random_uuid());
  assert (select kind is null from cook_log_items where cook_log_id = log2);
  assert (select quantity from ingredients where id = potato) = 3;
end $$;

-- 他の家の人(Q)は、P家のレシピのカテゴリ・材料を変えられず、作ったことにもできない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff202', false);
do $$
begin
  assert pg_temp.err(format('select update_recipe(%L, %L, null, null, null, null, %L, null, %L, true)', current_setting('test.r'), '乗っ取り',
    jsonb_build_array(jsonb_build_object('source_name', 'x')), 'korean')) = '権限がありません';
  assert pg_temp.err(format('select cook_recipe_v2(%L, %L, %L)', current_setting('test.r'),
    jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.other'), 'quantity', 1, 'kind', 'extra')), gen_random_uuid())) = '権限がありません';
  assert (select quantity from ingredients where id = current_setting('test.other')::uuid) = 3, 'Q家の在庫は変わらない';
end $$;

\echo 'recipe_category_optional.test.sql: all assertions passed'
