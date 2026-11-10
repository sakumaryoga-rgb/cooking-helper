-- migration 030(「どれか1つ」の材料)のテスト。合成データのみ
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000ff401'),  -- C: C家
  ('00000000-0000-4000-8000-0000000ff402');  -- D: D家(他人)

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
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff401', false);
do $$
declare
  g groups;
  aibiki uuid;
  gyu uuid;
  buta uuid;
  onion uuid;
  egg uuid;
  r uuid;
  items jsonb;
  log1 uuid;
begin
  g := create_group('C家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '合い挽き肉', 'g', 0) returning id into aibiki;
  perform adjust_ingredient_quantity(aibiki, 400, true);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '牛ひき肉', 'g', 0) returning id into gyu;
  perform adjust_ingredient_quantity(gyu, 300, true);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '豚こま切れ肉', 'g', 0) returning id into buta;
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '玉ねぎ', '個', 0) returning id into onion;
  perform adjust_ingredient_quantity(onion, 3, true);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '卵', '個', 0) returning id into egg;
  perform adjust_ingredient_quantity(egg, 6, true);
  insert into recipes (group_id, title) values (g.id, 'ハンバーグ') returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, onion, 1);
  perform set_config('test.r', r::text, false);
  perform set_config('test.aibiki', aibiki::text, false);
  perform set_config('test.gyu', gyu::text, false);

  -- 1. 既存の材料は組なし
  assert (select choice_group is null from recipe_ingredients where recipe_id = r), '既存の材料は組なし';

  -- 2. 候補を組で保存する(候補ごとに分量を持つ)。候補1つの組は解除。組に必須があれば組をすべて必須にそろえる
  items := jsonb_build_array(
    jsonb_build_object('ingredient_id', aibiki, 'required_quantity', 300, 'choice_group', 1),
    jsonb_build_object('ingredient_id', gyu, 'required_quantity', 300, 'choice_group', 1, 'optional', true),
    jsonb_build_object('ingredient_id', buta, 'required_quantity', 250, 'choice_group', 1),
    jsonb_build_object('ingredient_id', onion, 'required_quantity', 1, 'choice_group', 2),
    jsonb_build_object('source_name', 'パン粉', 'amount_text', '大さじ3', 'choice_group', null));
  perform update_recipe(r, 'ハンバーグ', 2, null, null, null, items);
  assert (select count(*) from recipe_ingredients where recipe_id = r and choice_group = 1) = 3, '3つの候補が同じ組';
  assert (select required_quantity from recipe_ingredients where recipe_id = r and ingredient_id = buta) = 250, '候補ごとの分量';
  assert (select choice_group is null from recipe_ingredients where recipe_id = r and ingredient_id = onion), '候補が1つの組は解除';
  assert not exists (select 1 from recipe_ingredients where recipe_id = r and choice_group = 1 and optional), '組に必須があれば組はすべて必須';

  -- 3. choice_group の指定がない(古いアプリの編集)ときは、今の組を引き継ぐ
  items := jsonb_build_array(
    jsonb_build_object('ingredient_id', aibiki, 'required_quantity', 300),
    jsonb_build_object('ingredient_id', gyu, 'required_quantity', 300),
    jsonb_build_object('ingredient_id', buta, 'required_quantity', 250),
    jsonb_build_object('ingredient_id', onion, 'required_quantity', 1),
    jsonb_build_object('source_name', 'パン粉', 'amount_text', '大さじ3'));
  perform update_recipe(r, 'ハンバーグ', 2, null, null, null, items);
  assert (select count(*) from recipe_ingredients where recipe_id = r and choice_group = 1) = 3, '古いアプリの編集でも組が残る';

  -- 4. 同じ食材を単独と組の両方で送ったら、単独の材料にまとめる
  items := jsonb_build_array(
    jsonb_build_object('ingredient_id', aibiki, 'required_quantity', 300, 'choice_group', 1),
    jsonb_build_object('ingredient_id', gyu, 'required_quantity', 300, 'choice_group', 1),
    jsonb_build_object('ingredient_id', gyu, 'required_quantity', 50, 'choice_group', null),
    jsonb_build_object('ingredient_id', buta, 'required_quantity', 250, 'choice_group', 1),
    jsonb_build_object('ingredient_id', onion, 'required_quantity', 1));
  perform update_recipe(r, 'ハンバーグ', 2, null, null, null, items);
  assert (select choice_group is null and required_quantity = 350 from recipe_ingredients where recipe_id = r and ingredient_id = gyu), '単独の材料を優先してまとめる';
  assert (select count(*) from recipe_ingredients where recipe_id = r and choice_group = 1) = 2, '残りの2つは組のまま';

  -- 組を戻す
  items := jsonb_build_array(
    jsonb_build_object('ingredient_id', aibiki, 'required_quantity', 300, 'choice_group', 1),
    jsonb_build_object('ingredient_id', gyu, 'required_quantity', 300, 'choice_group', 1),
    jsonb_build_object('ingredient_id', buta, 'required_quantity', 250, 'choice_group', 1),
    jsonb_build_object('ingredient_id', onion, 'required_quantity', 1),
    jsonb_build_object('ingredient_id', egg, 'required_quantity', 1));
  perform update_recipe(r, 'ハンバーグ', 2, null, null, null, items);

  -- 5. 作った: 組から1つ選んで引く(選ばなかった候補は引かない)
  log1 := cook_recipe_v2(r, jsonb_build_array(
    jsonb_build_object('ingredient_id', gyu, 'quantity', 300, 'kind', 'required'),
    jsonb_build_object('ingredient_id', onion, 'quantity', 1, 'kind', 'required'),
    jsonb_build_object('ingredient_id', egg, 'quantity', 1, 'kind', 'required')), gen_random_uuid());
  assert (select quantity from ingredients where id = gyu) = 0, '選んだ候補(牛ひき肉)を引く';
  assert (select quantity from ingredients where id = aibiki) = 400, '選ばなかった候補は引かない';
  assert (select kind from cook_log_items where cook_log_id = log1 and ingredient_id = gyu) = 'required';

  -- 6. 旧版の「作った」(cook_recipe)は組の材料を引かない
  perform cook_recipe(r);
  assert (select quantity from ingredients where id = aibiki) = 400, '旧版は組の材料を引かない';
  assert (select quantity from ingredients where id = onion) = 1, '旧版でも組でない材料は引く';
end $$;

-- 7. 同じ組の候補を2つ以上引こうとしたら拒否する(古いアプリ: kind なしで候補をすべて送る場合も)
do $$
declare
  r uuid := current_setting('test.r')::uuid;
  a uuid := current_setting('test.aibiki')::uuid;
  g uuid := current_setting('test.gyu')::uuid;
begin
  perform adjust_ingredient_quantity(g, 300, true);
  assert pg_temp.err(format('select cook_recipe_v2(%L, %L::jsonb, gen_random_uuid())', r,
    jsonb_build_array(jsonb_build_object('ingredient_id', a, 'quantity', 300, 'kind', 'required'),
                      jsonb_build_object('ingredient_id', g, 'quantity', 300, 'kind', 'required')))) like 'アプリを最新版に更新してください%', '同じ組を2つ引けない';
  assert pg_temp.err(format('select cook_recipe_v2(%L, %L::jsonb, gen_random_uuid())', r,
    jsonb_build_array(jsonb_build_object('ingredient_id', a, 'quantity', 300),
                      jsonb_build_object('ingredient_id', g, 'quantity', 300)))) like 'アプリを最新版に更新してください%', '古いアプリ(kind なし)も拒否';
  assert (select quantity from ingredients where id = a) = 400, '拒否したときは在庫を変えない';
  -- 量0の候補は「使っていない」ので数えない
  perform cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', a, 'quantity', 300, 'kind', 'required'),
                                              jsonb_build_object('ingredient_id', g, 'quantity', 0, 'kind', 'required')), gen_random_uuid());
  assert (select quantity from ingredients where id = a) = 100, '量0の候補は数えない';
end $$;

-- 8. 指定の形を確かめる
do $$
declare
  r uuid := current_setting('test.r')::uuid;
  a uuid := current_setting('test.aibiki')::uuid;
  bad jsonb;
begin
  foreach bad in array array['0'::jsonb, '51'::jsonb, '"1"'::jsonb, '1.5'::jsonb] loop
    assert pg_temp.err(format('select update_recipe(%L, %L, 2, null, null, null, %L::jsonb)', r, 'ハンバーグ',
      jsonb_build_array(jsonb_build_object('ingredient_id', a, 'required_quantity', 1, 'choice_group', bad)))) = '「どれか1つ」の材料の指定が正しくありません', bad::text;
  end loop;
  assert pg_temp.err('update recipe_ingredients set choice_group = 99 where recipe_id = ''' || r || '''') is not null, '列の範囲の制約';
end $$;

-- 9. 他人(D)は C家のレシピの組を整えられない(RLS)
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff402', false);
do $$
declare
  g groups;
begin
  g := create_group('D家');
end $$;
do $$
begin
  perform normalize_choice_groups(current_setting('test.r')::uuid);
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff401', false);
do $$
begin
  assert (select count(*) from recipe_ingredients where recipe_id = current_setting('test.r')::uuid and choice_group = 1) = 3, '他人からは変わらない';
end $$;

\echo 'recipe_choice_groups.test.sql: all assertions passed'
