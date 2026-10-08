-- migration 009(page_views / client_errors)の権限、RLS、形式チェック、90日削除のテスト。
-- 合成データのみ。inventory.test.sql と独立させるため、専用のユーザーとグループを作る。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000d1'),
  ('00000000-0000-4000-8000-0000000000e1');

-- D家とE家を作る
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e1', false);
do $$
declare g groups;
begin
  g := create_group('E家');
  perform set_config('test.e_group', g.id::text, false);
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d1', false);
do $$
declare g groups;
begin
  g := create_group('D家');
  perform set_config('test.d_group', g.id::text, false);
end $$;

-- ---------------------------------------------------------------
-- 1. 本人の行は書ける。user_id と created_at は自動で決まる
-- ---------------------------------------------------------------
insert into page_views (group_id, app_version, path)
values (current_setting('test.d_group')::uuid, '1.1.0', '/recipes/:id');
insert into page_views (group_id, app_version, path) values (null, '1.1.0', '/login');
insert into client_errors (group_id, app_version, path, kind, message, stack, fingerprint)
values (current_setting('test.d_group')::uuid, '1.1.0', '/fridge', 'error', 'TypeError: x is undefined', 'at f (/assets/index.js:1:2)', '0a1b2c3d');

-- ---------------------------------------------------------------
-- 2. 拒否されるべき操作
-- ---------------------------------------------------------------
do $$
declare
  d uuid := current_setting('test.d_group')::uuid;
  e uuid := current_setting('test.e_group')::uuid;
  procedure_ok boolean;
begin
  -- 他のグループになりすます
  begin
    insert into page_views (group_id, app_version, path) values (e, '1.1.0', '/fridge');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into client_errors (group_id, app_version, path, kind, message, fingerprint)
    values (e, '1.1.0', '/fridge', 'error', 'x', '0a1b2c3d');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;

  -- 他人の user_id や過去の日時は指定できない(列の INSERT 権限がない)
  begin
    insert into page_views (user_id, group_id, app_version, path)
    values ('00000000-0000-4000-8000-0000000000e1', d, '1.1.0', '/fridge');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into page_views (created_at, group_id, app_version, path)
    values (now() - interval '200 days', d, '1.1.0', '/fridge');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;

  -- 読み取り・更新・削除はできない
  begin
    perform count(*) from page_views;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from client_errors;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update page_views set path = '/group';
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from client_errors;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;

  -- 削除関数はクライアントから実行できない
  begin
    perform purge_usage_and_error_logs();
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------
-- 3. 形式と長さの制限(レシピの ID、クエリ、メールアドレスなどは入らない)
-- ---------------------------------------------------------------
do $$
declare
  d uuid := current_setting('test.d_group')::uuid;
  bad_path text;
begin
  foreach bad_path in array array[
    '/recipes/123e4567-e89b-12d3-a456-426614174000',
    '/onboarding?code=ABCD1234',
    '/fridge#top',
    'fridge',
    '/user@example.com',
    '/' || repeat('a', 64)
  ] loop
    begin
      insert into page_views (group_id, app_version, path) values (d, '1.1.0', bad_path);
      raise exception 'should have failed: %', bad_path;
    exception when check_violation then null;
    end;
  end loop;

  begin
    insert into page_views (group_id, app_version, path) values (d, 'dev', '/fridge');
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    insert into client_errors (group_id, app_version, path, kind, message, fingerprint)
    values (d, '1.1.0', '/fridge', 'error', repeat('x', 501), '0a1b2c3d');
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    insert into client_errors (group_id, app_version, path, kind, message, stack, fingerprint)
    values (d, '1.1.0', '/fridge', 'error', 'x', repeat('s', 2001), '0a1b2c3d');
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    insert into client_errors (group_id, app_version, path, kind, message, fingerprint)
    values (d, '1.1.0', '/fridge', 'console', 'x', '0a1b2c3d');
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    insert into client_errors (group_id, app_version, path, kind, message, fingerprint)
    values (d, '1.1.0', '/fridge', 'error', '', '0a1b2c3d');
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    insert into client_errors (group_id, app_version, path, kind, message, fingerprint)
    values (d, '1.1.0', '/fridge', 'error', 'x', 'not-hex!');
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------
-- 4. 未ログイン(anon)は書けない
-- ---------------------------------------------------------------
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  begin
    insert into page_views (app_version, path) values ('1.1.0', '/login');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------
-- 5. 書かれた内容の確認と、90日削除(管理者 = SQL Editor の立場)
-- ---------------------------------------------------------------
reset role;
do $$
declare
  d uuid := current_setting('test.d_group')::uuid;
  r record;
begin
  assert (select count(*) from page_views where user_id = '00000000-0000-4000-8000-0000000000d1') = 2, 'D のページビューは2件';
  assert (select count(*) from page_views where group_id = d) = 1, 'D家のページビューは1件(もう1件は null)';
  assert (select count(*) from client_errors where user_id = '00000000-0000-4000-8000-0000000000d1') = 1, 'D のエラーは1件';
  assert (select bool_and(created_at > now() - interval '1 minute') from page_views), 'created_at は書き込み時刻';

  -- 古い行を作り、削除されることを確かめる
  insert into page_views (created_at, user_id, group_id, app_version, path)
  values (now() - interval '91 days', '00000000-0000-4000-8000-0000000000d1', d, '1.0.0', '/fridge'),
         (now() - interval '89 days', '00000000-0000-4000-8000-0000000000d1', d, '1.0.0', '/fridge');
  insert into client_errors (created_at, user_id, group_id, app_version, path, kind, message, fingerprint)
  values (now() - interval '120 days', '00000000-0000-4000-8000-0000000000d1', d, '1.0.0', '/fridge', 'error', 'old', '0a1b2c3d');

  select * into r from purge_usage_and_error_logs();
  assert r.purged_page_views = 1 and r.purged_client_errors = 1, '91日前と120日前の行だけが消える';
  assert (select count(*) from page_views) = 3, '89日前の行は残る';

  begin
    perform purge_usage_and_error_logs(interval '1 hour');
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '保存期間が短すぎます', sqlerrm;
  end;

  -- グループが削除されたら group_id は null になり、記録は残る(集計の件数を保つ)
  delete from group_members where group_id = d;
  delete from groups where id = d;
  assert (select count(*) from page_views where group_id is null and user_id = '00000000-0000-4000-8000-0000000000d1') = 3, 'グループ削除後も記録は残る';
end $$;

\echo 'usage_logs.test.sql: all assertions passed'
