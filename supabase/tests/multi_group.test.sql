-- migration 021(1つのアカウントで複数の家に参加・切り替え)のテスト。合成データのみ。
-- アプリは選択中の家を x-cookdoor-group ヘッダーで送る。テストでは request.headers を設定して再現する。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000ee01'),  -- P: 自分の家(P家)を持ち、招待で Q家にも参加する
  ('00000000-0000-4000-8000-00000000ee02'),  -- Q: Q家の持ち主
  ('00000000-0000-4000-8000-00000000ee03');  -- R: どちらにも入っていない(他人)

set role authenticated;
-- Q が Q家を作り、在庫とレシピを入れて招待を出す
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ee02', false);
select set_config('request.headers', '', false);
do $$
declare g groups;
begin
  g := create_group('Q家');
  perform set_config('test.q', g.id::text, false);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'Qの卵', '個', 6);
  insert into recipes (group_id, title) values (g.id, 'Qのオムレツ');
  perform set_config('test.q_token', (select invite_token from create_group_invite()), false);
end $$;

-- P は自分の P家を持ったまま、招待で Q家に参加する
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ee01', false);
do $$
declare
  p groups;
  joined groups;
  again groups;
begin
  p := create_group('P家');
  perform set_config('test.p', p.id::text, false);
  insert into ingredients (group_id, name, unit, quantity) values (p.id, 'Pの牛乳', 'ml', 500);

  joined := join_group_with_invite(current_setting('test.q_token'));
  assert joined.id = current_setting('test.q')::uuid, '既存の家を持っていても招待先に参加できる';
  again := join_group_with_invite(current_setting('test.q_token'));
  assert again.id = joined.id, 'すでに参加している家の招待はその家を返す(切り替え)';
  assert (select count(*) from group_members where user_id = auth.uid()) = 2, 'P は2つの家のメンバー';
  assert exists (select 1 from ingredients where name = 'Pの牛乳'), '自分の家のデータは消えない';

  -- 2つ目の家も作れる
  perform create_group('P の実家');
  assert (select count(*) from group_members where user_id = auth.uid()) = 3;
  -- 一覧: 所属しているすべての家が見える
  assert (select count(*) from groups) = 3, '所属している3つの家が見える';
end $$;

-- ヘッダーなし(旧版のアプリ・リアルタイム)は最初に参加した家
do $$
begin
  assert my_group_id() = current_setting('test.p')::uuid, 'ヘッダーなしは最初の家';
end $$;

-- Q家を選ぶ(ヘッダー)と、RPC と書き込みは Q家に限定される
select set_config('request.headers', json_build_object('x-cookdoor-group', current_setting('test.q'))::text, false);
do $$
declare
  q_egg uuid;
  p_milk uuid;
  n int;
begin
  assert my_group_id() = current_setting('test.q')::uuid, '選んだ家';
  select id into q_egg from ingredients where name = 'Qの卵';
  select id into p_milk from ingredients where name = 'Pの牛乳';
  perform adjust_stock(q_egg, -1, true, null, null);
  assert (select quantity from ingredients where id = q_egg) = 5, '選んだ家の在庫は変えられる';
  -- 選んでいない家(P家)の在庫は RPC でも直接でも変えられない
  begin
    perform adjust_stock(p_milk, -100, true, null, null);
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '権限がありません', sqlerrm;
  end;
  update ingredients set quantity = 0 where id = p_milk;
  get diagnostics n = row_count;
  assert n = 0, '選んでいない家の在庫は直接も変えられない';
  begin
    insert into ingredients (group_id, name, unit) values (current_setting('test.p')::uuid, '混入', '個');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  -- 招待は選んだ家のもの
  perform revoke_group_invite();
end $$;
reset role;
do $$
begin
  assert (select quantity from ingredients where name = 'Pの牛乳') = 500, 'P家の在庫は壊れない';
  assert not exists (select 1 from group_invites where group_id = current_setting('test.q')::uuid and revoked_at is null), 'Q家の招待が無効化された';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ee01', false);

-- 所属していない家・壊れた値をヘッダーに入れても、他の家のデータには届かない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ee03', false);
do $$ begin perform create_group('R家'); end $$;
select set_config('request.headers', json_build_object('x-cookdoor-group', current_setting('test.q'))::text, false);
do $$
declare n int;
begin
  assert my_group_id() is null, '所属していない家を選んでも使えない';
  assert (select count(*) from ingredients where name = 'Qの卵') = 0, 'Q家の在庫は見えない';
  assert (select count(*) from groups where id = current_setting('test.q')::uuid) = 0, 'Q家は見えない';
  update ingredients set quantity = 99 where name = 'Qの卵';
  get diagnostics n = row_count;
  assert n = 0, 'Q家の在庫は変えられない';
  begin
    perform create_group_invite();
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '権限がありません', sqlerrm;
  end;
end $$;
select set_config('request.headers', '{"x-cookdoor-group": "not-a-uuid"}', false);
do $$
begin
  assert my_group_id() is null, '壊れた値なら何も選ばれない';
end $$;

-- 調理の記録と在庫は、家を切り替えても壊れない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ee01', false);
select set_config('request.headers', json_build_object('x-cookdoor-group', current_setting('test.q'))::text, false);
do $$
declare
  r uuid;
  egg uuid;
  log uuid;
begin
  select id into r from recipes where title = 'Qのオムレツ';
  select id into egg from ingredients where name = 'Qの卵';
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, egg, 2);
  log := cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', egg, 'quantity', 2)), gen_random_uuid());
  assert (select quantity from ingredients where id = egg) = 3;
  perform set_config('test.log', log::text, false);
end $$;
-- P家に切り替えると、Q家の記録は取り消せない(選んだ家だけ)
select set_config('request.headers', json_build_object('x-cookdoor-group', current_setting('test.p'))::text, false);
do $$
begin
  perform undo_cook(current_setting('test.log')::uuid);
  raise exception 'should have failed';
exception when others then
  assert sqlerrm = '権限がありません', sqlerrm;
end $$;
-- Q家に戻すと取り消せて、在庫が戻る
select set_config('request.headers', json_build_object('x-cookdoor-group', current_setting('test.q'))::text, false);
do $$
begin
  assert undo_cook(current_setting('test.log')::uuid);
  assert (select quantity from ingredients where name = 'Qの卵') = 5, '在庫が戻る';
end $$;

reset role;
select set_config('request.headers', '', false);
\echo 'multi_group.test.sql: all assertions passed'
