-- migration 022(家の管理: 管理者・メンバー、脱退、退出、譲渡、削除)のテスト。合成データのみ。
-- A: A家の管理者(作った人)。B: A家のメンバー、自分の B家も持つ。C: A家のメンバー。D: 部外者

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000ff001'),
  ('00000000-0000-4000-8000-0000000ff002'),
  ('00000000-0000-4000-8000-0000000ff003'),
  ('00000000-0000-4000-8000-0000000ff004');

-- 呼び出す人を切り替える(選択中の家のヘッダーは付けない)
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff00' || p, false);
  select set_config('request.headers', '', false);
$$;
-- 例外のメッセージを返す(例外がなければ null)
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

set role authenticated;

-- A が A家を作る → A が管理者。B と C が招待で参加 → メンバー
select pg_temp.as_user('1');
do $$
declare g groups;
begin
  g := create_group('A家');
  perform set_config('test.a', g.id::text, false);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'Aの卵', '個', 6);
  insert into recipes (group_id, title) values (g.id, 'Aのオムレツ');
  perform set_config('test.a_token', (select invite_token from create_group_invite()), false);
  assert (select role from group_members where group_id = g.id and user_id = auth.uid()) = 'owner', '家を作った人が管理者';
end $$;

select pg_temp.as_user('2');
do $$
declare g groups;
begin
  g := create_group('B家');
  perform set_config('test.b', g.id::text, false);
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'Bの牛乳', 'ml', 500);
  insert into recipes (group_id, title) values (g.id, 'Bのスープ');
end $$;
do $$
begin
  perform join_group_with_invite(current_setting('test.a_token'));
  assert (select role from group_members where group_id = current_setting('test.a')::uuid and user_id = auth.uid()) = 'member', '招待で入った人はメンバー';
  assert (select role from group_members where group_id = current_setting('test.b')::uuid and user_id = auth.uid()) = 'owner', '家ごとに権限が違う';
end $$;
select pg_temp.as_user('3');
select join_group_with_invite(current_setting('test.a_token'));

-- 一般メンバー(B)は管理者の操作ができない。自分の家(B家)の管理者でも、A家の管理はできない
select pg_temp.as_user('2');
do $$
declare a text := current_setting('test.a');
begin
  assert pg_temp.err(format('select rename_group(%L, %L)', a, '乗っ取り')) = '家の管理者だけが変更できます';
  assert pg_temp.err(format('select remove_group_member(%L, %L)', a, '00000000-0000-4000-8000-0000000ff003')) = '家の管理者だけが操作できます';
  assert pg_temp.err(format('select transfer_group_owner(%L, %L)', a, '00000000-0000-4000-8000-0000000ff002')) = '家の管理者だけが操作できます';
  assert pg_temp.err(format('select delete_group(%L, %L)', a, 'A家')) = '家の管理者だけが削除できます';
  -- 直接の書き換えもできない(group_members / groups に書き込みのポリシーはない)
  update group_members set role = 'owner' where group_id = a::uuid and user_id = auth.uid();
  update groups set name = '乗っ取り' where id = a::uuid;
  delete from group_members where group_id = a::uuid;
  delete from groups where id = a::uuid;
end $$;
-- 部外者(D)は何もできない
select pg_temp.as_user('4');
do $$
declare a text := current_setting('test.a');
begin
  assert pg_temp.err(format('select leave_group(%L)', a)) = 'この家のメンバーではありません';
  assert pg_temp.err(format('select set_my_house_display_name(%L, %L)', a, 'D')) = '権限がありません';
  assert pg_temp.err(format('select delete_group(%L, %L)', a, 'A家')) = '家の管理者だけが削除できます';
  assert (select count(*) from group_members) = 0, '部外者にはメンバーが見えない';
end $$;
reset role;
do $$
begin
  assert (select name from groups where id = current_setting('test.a')::uuid) = 'A家', '名前は変わっていない';
  assert (select count(*) from group_members where group_id = current_setting('test.a')::uuid) = 3, 'メンバーは消えていない';
  assert (select count(*) from group_members where group_id = current_setting('test.a')::uuid and role = 'owner') = 1;
end $$;
set role authenticated;

-- 呼び名と名前の変更
select pg_temp.as_user('2');
do $$
begin
  perform set_my_house_display_name(current_setting('test.a')::uuid, '  ママ ');
  assert (select display_name from group_members where group_id = current_setting('test.a')::uuid and user_id = auth.uid()) = 'ママ';
  assert (select display_name from group_members where group_id = current_setting('test.b')::uuid and user_id = auth.uid()) is null, '呼び名は家ごと';
  assert pg_temp.err(format('select set_my_house_display_name(%L, %L)', current_setting('test.a'), repeat('あ', 21))) = '呼び名は20文字以内にしてください';
end $$;
select pg_temp.as_user('1');
do $$
begin
  assert (select name from rename_group(current_setting('test.a')::uuid, ' わが家 ')) = 'わが家';
  assert pg_temp.err(format('select rename_group(%L, %L)', current_setting('test.a'), '')) = '家の名前は1〜40文字にしてください';
  -- 管理者は自分を退出させられない・譲渡前に脱退できない
  assert pg_temp.err(format('select remove_group_member(%L, %L)', current_setting('test.a'), auth.uid())) like '自分自身は退出させられません%';
  assert pg_temp.err(format('select leave_group(%L)', current_setting('test.a'))) like '管理者は、先にほかのメンバーへ管理者を譲って%';
  assert pg_temp.err(format('select transfer_group_owner(%L, %L)', current_setting('test.a'), '00000000-0000-4000-8000-0000000ff004')) = 'このメンバーは家にいません', '所属していない人には譲れない';
end $$;

-- 管理者を譲る: A → B。管理者は常に1人
do $$
declare a uuid := current_setting('test.a')::uuid;
begin
  perform transfer_group_owner(a, '00000000-0000-4000-8000-0000000ff002');
  assert (select user_id from group_members where group_id = a and role = 'owner') = '00000000-0000-4000-8000-0000000ff002';
  assert (select count(*) from group_members where group_id = a and role = 'owner') = 1, '二重の管理者にならない';
  assert (select role from group_members where group_id = a and user_id = auth.uid()) = 'member';
  assert pg_temp.err(format('select rename_group(%L, %L)', a, 'x')) = '家の管理者だけが変更できます', '旧管理者は管理できなくなる';
end $$;

-- 新しい管理者(B)が C を退出させる → C は A家のデータに即座にアクセスできない。招待リンクも無効になる
select pg_temp.as_user('2');
select remove_group_member(current_setting('test.a')::uuid, '00000000-0000-4000-8000-0000000ff003');
reset role;
do $$
begin
  assert not exists (select 1 from group_invites where group_id = current_setting('test.a')::uuid and revoked_at is null), '退出させると招待リンクは無効';
end $$;
set role authenticated;
select pg_temp.as_user('3');
select set_config('request.headers', json_build_object('x-cookdoor-group', current_setting('test.a'))::text, false);
do $$
declare n int;
begin
  assert my_group_id() is null, '退出した家を選んでいても、その家として扱わない';
  assert (select count(*) from ingredients) = 0 and (select count(*) from recipes) = 0, '退出した家のデータは見えない';
  update ingredients set quantity = 0 where name = 'Aの卵';
  get diagnostics n = row_count;
  assert n = 0, '古いアプリから書き込めない';
  begin
    insert into ingredients (group_id, name, unit, quantity) values (current_setting('test.a')::uuid, '侵入', '個', 1);
    assert false, '追加もできない';
  exception when insufficient_privilege then null;
  end;
  assert join_group_with_invite(current_setting('test.a_token')) is null, '古い招待リンクでは戻れない';
end $$;

-- メンバー(A)が脱退する → A家から抜けるだけ。A家・他のメンバー・データは残る
select pg_temp.as_user('1');
select leave_group(current_setting('test.a')::uuid);
reset role;
do $$
declare a uuid := current_setting('test.a')::uuid;
begin
  assert not exists (select 1 from group_members where group_id = a and user_id = '00000000-0000-4000-8000-0000000ff001');
  assert exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000ff001'), 'アカウントは残る';
  assert exists (select 1 from ingredients where group_id = a and name = 'Aの卵'), '家のデータは残る';
  assert (select count(*) from group_members where group_id = a) = 1;
end $$;

-- 管理者がいる家に入った人は必ずメンバー
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  t groups;
begin
  insert into group_members (group_id, user_id) values (current_setting('test.b')::uuid, '00000000-0000-4000-8000-0000000ff004');
  assert (select role from group_members where group_id = current_setting('test.b')::uuid and user_id = '00000000-0000-4000-8000-0000000ff004') = 'member', '管理者がいる家に入ると必ずメンバー';
end $$;

-- 家の削除: B が B家を削除する。名前の確認が必要。B家のデータだけが消え、A家は残る
set role authenticated;
select pg_temp.as_user('2');
do $$
declare
  b uuid := current_setting('test.b')::uuid;
  egg uuid;
  r uuid;
begin
  -- B家に調理記録と招待も作っておく
  select id into egg from ingredients where group_id = b;
  select id into r from recipes where group_id = b;
  perform set_config('request.headers', json_build_object('x-cookdoor-group', b)::text, false);
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, egg, 100);
  perform cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', egg, 'quantity', 100)), gen_random_uuid());
  perform create_group_invite();
  assert pg_temp.err(format('select delete_group(%L, %L)', b, 'Bの家')) = '家の名前が一致しません';
  perform delete_group(b, 'B家');
end $$;
reset role;
do $$
declare
  a uuid := current_setting('test.a')::uuid;
  b uuid := current_setting('test.b')::uuid;
begin
  assert not exists (select 1 from groups where id = b);
  assert not exists (select 1 from group_members where group_id = b);
  assert not exists (select 1 from ingredients where group_id = b);
  assert not exists (select 1 from recipes where group_id = b);
  assert not exists (select 1 from cook_logs where group_id = b);
  assert not exists (select 1 from group_invites where group_id = b);
  -- 他の家(A家)は残る
  assert exists (select 1 from groups where id = a and name = 'わが家');
  assert exists (select 1 from ingredients where group_id = a and name = 'Aの卵');
  assert exists (select 1 from recipes where group_id = a and title = 'Aのオムレツ');
  assert (select count(*) from group_members where group_id = a and role = 'owner') = 1, 'A家の管理者は B のまま';
  -- B のアカウントと A家の所属は残る
  assert exists (select 1 from group_members where group_id = a and user_id = '00000000-0000-4000-8000-0000000ff002');
end $$;

-- アカウント削除で管理者がいなくなる場合: A家の管理者 B を消すと、残っている人が管理者になる
do $$
declare a uuid := current_setting('test.a')::uuid;
begin
  insert into group_members (group_id, user_id) values (a, '00000000-0000-4000-8000-0000000ff004');
  delete from auth.users where id = '00000000-0000-4000-8000-0000000ff002';
  assert (select user_id from group_members where group_id = a and role = 'owner') = '00000000-0000-4000-8000-0000000ff004', '管理者のいない家にならない';
end $$;

\echo 'house_management.test.sql: all assertions passed'
