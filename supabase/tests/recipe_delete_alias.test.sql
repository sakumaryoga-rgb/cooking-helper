-- レシピの削除と、家庭の別名の学習(v1.15.0、DB の変更なし)のテスト。合成データのみ
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000dd001'),  -- U: U家
  ('00000000-0000-4000-8000-0000000dd002');  -- V: V家(他人)

set role authenticated;
select set_config('request.headers', '', false);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000dd002', false);
do $$
declare g groups;
begin
  g := create_group('V家');
  perform set_config('test.v', g.id::text, false);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000dd001', false);
do $$
declare
  g groups;
  potato uuid;
  r uuid;
  log uuid;
  n int;
begin
  g := create_group('U家');
  perform set_config('test.u', g.id::text, false);
  insert into ingredients (group_id, name, unit, quantity, catalog_id)
  values (g.id, 'じゃがいも', '個', 5, (select id from ingredient_catalog where name = 'じゃがいも' and group_id is null))
  returning id into potato;
  insert into recipes (group_id, title) values (g.id, 'ポテトサラダ') returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, potato, 2);
  log := cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', potato, 'quantity', 2)), gen_random_uuid());
  perform set_config('test.r', r::text, false);
  perform set_config('test.log', log::text, false);
  perform set_config('test.potato', potato::text, false);

  -- 取り込んだ表記を家庭の別名として覚える
  insert into ingredient_aliases (group_id, catalog_id, alias)
  values (g.id, (select catalog_id from ingredients where id = potato), 'メークイン');
  assert exists (select 1 from ingredient_aliases where alias = 'メークイン'), '自分の家の別名は読める';
  -- 他の家の別名としては登録できない
  begin
    insert into ingredient_aliases (group_id, catalog_id, alias)
    values (current_setting('test.v')::uuid, (select catalog_id from ingredients where id = potato), '男爵');
    assert false, '他の家の別名は登録できない';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 他の家の人(V)は、U家のレシピを削除できず、U家の別名も見えない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000dd002', false);
do $$
declare n int;
begin
  delete from recipes where id = current_setting('test.r')::uuid;
  get diagnostics n = row_count;
  assert n = 0, '他の家のレシピは削除できない';
  assert not exists (select 1 from ingredient_aliases where alias = 'メークイン'), '他の家の別名は見えない';
end $$;

-- U はレシピを削除できる。材料の行は消え、冷蔵庫の食材と作った記録は残り、取り消しもできる
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000dd001', false);
do $$
declare n int;
begin
  delete from recipes where id = current_setting('test.r')::uuid;
  get diagnostics n = row_count;
  assert n = 1, '自分の家のレシピは削除できる';
  assert not exists (select 1 from recipe_ingredients where recipe_id = current_setting('test.r')::uuid);
  assert (select quantity from ingredients where id = current_setting('test.potato')::uuid) = 3, '冷蔵庫の食材は残る';
  perform undo_cook(current_setting('test.log')::uuid);
  assert (select quantity from ingredients where id = current_setting('test.potato')::uuid) = 5, 'レシピを消しても、作った記録は取り消せる';
end $$;
reset role;
select set_config('request.headers', '', false);

\echo 'recipe_delete_alias.test.sql: all assertions passed'
