-- 既存の在庫・調理・グループ機能の回帰テスト(migration 008 時点の挙動を固定する)。
-- 合成データのみを使う。失敗すると assert か raise で psql が止まる。

-- ---------------------------------------------------------------
-- 準備: 3人の合成ユーザー(A家の2人と、別世帯のB)
-- ---------------------------------------------------------------
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000c');

-- ---------------------------------------------------------------
-- 1. グループ作成(A)
-- ---------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
do $$
declare g groups;
begin
  g := create_group('A家');
  assert g.invite_code is null, '新しいグループには旧方式の招待コードを作らない(migration 011)';
  perform set_config('test.a_token', (select invite_token from create_group_invite()), false);
  assert my_group_id() = g.id, '作成者はそのグループに所属する';
  begin
    perform create_group('二つ目');
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = 'すでにグループに所属しています', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------
-- 2. adjust_ingredient_quantity: 増減、ロット、消費順、自動削除
-- ---------------------------------------------------------------
do $$
declare
  ing uuid;
  r record;
  n int;
begin
  insert into ingredients (group_id, name, unit, quantity)
  values (my_group_id(), '鶏もも肉', 'g', 0) returning id into ing;

  select * into r from adjust_ingredient_quantity(ing, 10, true);
  assert r.new_quantity = 10 and not r.deleted, '＋10(日付あり)';
  select * into r from adjust_ingredient_quantity(ing, 5, false);
  select * into r from adjust_ingredient_quantity(ing, 3, false);
  assert r.new_quantity = 18, '＋5、＋3(日付なし)で18';

  select count(*) into n from ingredient_batches where ingredient_id = ing and added_on is null;
  assert n = 1, '日付なしの追加は1つのロットにまとまる';
  assert (select quantity from ingredient_batches where ingredient_id = ing and added_on is null) = 8, '日付なしロットは8';
  assert (select quantity from ingredient_batches where ingredient_id = ing and added_on = current_date) = 10, '日付ありロットは10';

  -- 減らすときは日付なしロットから先に消費する
  select * into r from adjust_ingredient_quantity(ing, -12, true);
  assert r.new_quantity = 6, '－12で6';
  assert not exists (select 1 from ingredient_batches where ingredient_id = ing and added_on is null), '日付なしロットが先に消える';
  assert (select quantity from ingredient_batches where ingredient_id = ing) = 6, '日付ありロットが6残る';
  assert (select quantity from ingredients where id = ing) = 6, '在庫の数量も6';

  -- 在庫0になり、レシピから参照されていなければ食材ごと削除する
  select * into r from adjust_ingredient_quantity(ing, -100, true);
  assert r.new_quantity = 0 and r.deleted, '0未満にはならず、削除される';
  assert not exists (select 1 from ingredients where id = ing), '食材行が消える';
  assert not exists (select 1 from ingredient_batches where ingredient_id = ing), 'ロットも連鎖して消える';
end $$;

-- ---------------------------------------------------------------
-- 3. レシピから参照されている食材は在庫0でも残る / cook_recipe
-- ---------------------------------------------------------------
do $$
declare
  egg uuid;
  rec uuid;
  r record;
begin
  insert into ingredients (group_id, name, unit, quantity)
  values (my_group_id(), '卵', '個', 0) returning id into egg;
  perform adjust_ingredient_quantity(egg, 4, true);

  insert into recipes (group_id, title, created_by)
  values (my_group_id(), '卵焼き', auth.uid()) returning id into rec;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (rec, egg, 2);

  select * into r from adjust_ingredient_quantity(egg, -4, true);
  assert r.new_quantity = 0 and not r.deleted, 'レシピが参照していれば自動削除しない';
  assert exists (select 1 from ingredients where id = egg), '食材行は残る';

  perform adjust_ingredient_quantity(egg, 3, true);
  perform cook_recipe(rec);
  assert (select quantity from ingredients where id = egg) = 1, '必要量2を差し引く';
  assert (select coalesce(sum(quantity), 0) from ingredient_batches where ingredient_id = egg) = 1, 'ロットも同じだけ減る';

  perform cook_recipe(rec);
  assert (select quantity from ingredients where id = egg) = 0, '不足しても0で止まる';

  perform adjust_ingredient_quantity(egg, 5, true);
  perform cook_recipe(rec, jsonb_build_object(egg::text, 1));
  assert (select quantity from ingredients where id = egg) = 4, 'p_used で実際の使用量を指定できる';
end $$;

-- 既知の問題を固定するテスト(Phase 2 の migration 012 で変える予定):
-- 冷蔵庫の食材を直接削除すると、レシピの材料行も連鎖して消える
do $$
declare egg uuid;
begin
  select id into egg from ingredients where group_id = my_group_id() and name = '卵';
  delete from ingredients where id = egg;
  assert not exists (select 1 from recipe_ingredients where ingredient_id = egg), '現状は材料行も消える(012で修正予定)';
end $$;

-- ---------------------------------------------------------------
-- 4. 別世帯(B)からは見えず、操作もできない
-- ---------------------------------------------------------------
reset role;
select id as a_recipe from recipes where title = '卵焼き' \gset
insert into ingredients (group_id, name, unit, quantity)
select id, 'にんじん', '本', 2 from groups where name = 'A家';
select id as a_carrot from ingredients where name = 'にんじん' \gset
select id as a_group from groups where name = 'A家' \gset

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000b', false);
select set_config('test.a_carrot', :'a_carrot', false), set_config('test.a_recipe', :'a_recipe', false),
       set_config('test.a_group', :'a_group', false);
do $$
declare n int;
begin
  perform create_group('B家');
  select count(*) into n from ingredients;
  assert n = 0, 'B には A の食材が見えない';
  select count(*) into n from groups;
  assert n = 1, 'B には自分のグループしか見えない';
  select count(*) into n from recipes;
  assert n = 0, 'B には A のレシピが見えない';

  begin
    perform adjust_ingredient_quantity(current_setting('test.a_carrot')::uuid, -1, true);
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '権限がありません', sqlerrm;
  end;

  begin
    perform cook_recipe(current_setting('test.a_recipe')::uuid);
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '権限がありません', sqlerrm;
  end;

  begin
    insert into ingredients (group_id, name, unit) values (current_setting('test.a_group')::uuid, '侵入', '個');
    raise exception 'should have failed';
  exception when insufficient_privilege then
    null; -- RLS により拒否
  end;

  update ingredients set quantity = 99 where id = current_setting('test.a_carrot')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'B は A の食材を更新できない';

  begin
    perform join_group_with_invite(current_setting('test.a_token'));
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = 'すでにグループに所属しています', sqlerrm;
  end;
end $$;

reset role;
do $$
begin
  assert (select quantity from ingredients where name = 'にんじん') = 2, 'A の在庫は変わっていない';
end $$;

-- ---------------------------------------------------------------
-- 5. 招待リンク(トークン)での参加(C)。旧方式の招待コードは使えない
-- ---------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false);
do $$
declare g groups;
begin
  begin
    perform join_group('ZZZZZZZZ');
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm like '招待コードは使えなくなりました%', sqlerrm;
  end;

  g := join_group_with_invite('not-a-valid-token');
  assert g is null, '存在しないトークンでは参加できない';

  g := join_group_with_invite(current_setting('test.a_token'));
  assert g.name = 'A家', '招待トークンで参加できる';
  assert (select count(*) from ingredients) = 1, '参加後は A の食材が見える';
end $$;

-- ---------------------------------------------------------------
-- 6. 未ログイン(anon)は何も読めず、RPC も使えない
-- ---------------------------------------------------------------
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  assert (select count(*) from ingredients) = 0, 'anon は食材を読めない';
  assert (select count(*) from ingredient_catalog) = 0, 'anon は食材マスタも読めない';
  begin
    perform adjust_ingredient_quantity(gen_random_uuid(), 1, true);
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '権限がありません', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------
-- 7. 既知の問題を固定するテスト(Phase 2 の migration 013 で変える予定):
--    認証済みなら誰でも公式の食材マスタを削除できる
-- ---------------------------------------------------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000b', false);
do $$
declare n int;
begin
  delete from ingredient_catalog where name = 'ラム肉';
  get diagnostics n = row_count;
  assert n = 1, '現状は別世帯のユーザーでも公式マスタを削除できる(013で修正予定)';
end $$;

reset role;
\echo 'inventory.test.sql: all assertions passed'
