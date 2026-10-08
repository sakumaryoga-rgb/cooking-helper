-- migration 012(レシピURL取り込み)のテスト。既存の RLS が新しい列にも効くこと、重複の検出、形式チェック。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a7'),
  ('00000000-0000-4000-8000-0000000000b7');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b7', false);
do $$ begin perform create_group('R2家'); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a7', false);
do $$
declare
  g groups;
  r uuid;
  ing uuid;
begin
  g := create_group('R1家');
  perform set_config('test.r1_group', g.id::text, false);

  insert into recipes (group_id, title, url, source_key, source_site, servings, created_by)
  values (g.id, 'バンバンジー', 'https://delishkitchen.tv/recipes/194135459369058708', 'delishkitchen:194135459369058708', 'DELISH KITCHEN', 2, auth.uid())
  returning id into r;
  perform set_config('test.r1_recipe', r::text, false);

  insert into ingredients (group_id, name, unit, quantity) values (g.id, '鶏むね肉', 'g', 0) returning id into ing;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text)
  values (r, ing, 250, '鶏むね肉 1枚(250g)');

  -- 同じグループで同じレシピは二重に保存できない
  begin
    insert into recipes (group_id, title, source_key, created_by)
    values (g.id, 'もう一度', 'delishkitchen:194135459369058708', auth.uid());
    raise exception 'should have failed';
  exception when unique_violation then null;
  end;

  -- 形式チェック
  begin
    insert into recipes (group_id, title, source_key) values (g.id, 'x', 'https://example.com/a?b');
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    insert into recipes (group_id, title, servings) values (g.id, 'x', 0);
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text)
    values (r, ing, 1, repeat('x', 201));
    raise exception 'should have failed';
  exception when check_violation then null;
  end;

  -- 手動登録(source_key なし)は何件でも保存できる
  insert into recipes (group_id, title) values (g.id, '手動1'), (g.id, '手動2');
end $$;

-- 別のグループ(R2)は R1 のレシピを見られず、同じレシピを自分のグループに保存できる
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b7', false);
do $$
declare n int;
begin
  select count(*) into n from recipes where source_key is not null;
  assert n = 0, 'R2 には R1 の取り込みレシピが見えない';
  select count(*) into n from recipe_ingredients where raw_text is not null;
  assert n = 0, 'R2 には R1 の材料の元の行が見えない';

  insert into recipes (group_id, title, source_key) values (my_group_id(), 'バンバンジー', 'delishkitchen:194135459369058708');

  begin
    insert into recipes (group_id, title, source_key) values (current_setting('test.r1_group')::uuid, '侵入', 'nadia:1/2');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;

  update recipes set source_key = 'nadia:9/9' where id = current_setting('test.r1_recipe')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'R2 は R1 のレシピを変更できない';
end $$;

-- 冷蔵庫で削除しても、レシピが参照している食材は在庫0で残り、レシピの材料は消えない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a7', false);
do $$
declare
  used uuid;
  unused uuid;
  deleted boolean;
begin
  select ingredient_id into used from recipe_ingredients where raw_text = '鶏むね肉 1枚(250g)';
  update ingredients set quantity = 300 where id = used;
  insert into ingredient_batches (ingredient_id, quantity, added_on) values (used, 300, current_date);
  insert into ingredients (group_id, name, unit, quantity) values (my_group_id(), '使わない食材', '個', 2) returning id into unused;

  deleted := remove_ingredient(used);
  assert not deleted, 'レシピで使う食材は行を残す';
  assert (select quantity from ingredients where id = used) = 0, '在庫は0になる';
  assert not exists (select 1 from ingredient_batches where ingredient_id = used), 'ロットは消える';
  assert exists (select 1 from recipe_ingredients where ingredient_id = used), 'レシピの材料は残る';

  deleted := remove_ingredient(unused);
  assert deleted, 'レシピで使わない食材は削除する';
  assert not exists (select 1 from ingredients where id = unused), '行が消える';
end $$;

-- 別のグループの食材は削除できない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b7', false);
do $$
begin
  perform remove_ingredient((select ingredient_id from recipe_ingredients limit 1));
  raise exception 'should have failed';
exception when others then
  assert sqlerrm = '権限がありません', sqlerrm;
end $$;

reset role;
set role anon;
do $$
begin
  perform remove_ingredient(gen_random_uuid());
  raise exception 'should have failed';
exception when insufficient_privilege then null;
end $$;

reset role;
\echo 'recipe_import.test.sql: all assertions passed'
