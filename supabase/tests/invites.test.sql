-- migration 010 / 011(招待トークン)のテスト。合成データのみ。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-0000000000f2'),
  ('00000000-0000-4000-8000-0000000000f3'),
  ('00000000-0000-4000-8000-0000000000f4');

-- F1 が F家を作り、招待を発行する
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f1', false);
do $$
declare
  g groups;
  t1 text;
  t2 text;
  r record;
begin
  -- グループに所属していないと発行できない
  begin
    perform create_group_invite();
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '権限がありません', sqlerrm;
  end;

  g := create_group('F家');
  assert g.invite_code is null, '旧方式のコードは作らない';

  select * into r from get_group_invite_status();
  assert r is null or r.invite_active is null, '発行前は有効な招待がない';

  select invite_token into t1 from create_group_invite();
  assert t1 ~ '^[A-Za-z0-9_-]{43}$', 'トークンは URL に使える43文字';

  -- 再発行すると前のトークンは使えなくなる
  select invite_token into t2 from create_group_invite();
  assert t1 <> t2, '再発行で別のトークンになる';
  perform set_config('test.f_old', t1, false);
  perform set_config('test.f_token', t2, false);
  perform set_config('test.f_group', g.id::text, false);

  select * into r from get_group_invite_status();
  assert r.invite_active and r.invite_expires_at > now() + interval '6 days', '有効期限は7日';

  -- テーブルは直接読めない
  begin
    perform count(*) from group_invites;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from invite_join_attempts;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into group_invites (group_id, token_hash, created_by, expires_at)
    values (g.id, repeat('a', 64), auth.uid(), now() + interval '1 year');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  -- ハッシュ関数もクライアントからは使えない
  begin
    perform invite_token_hash('x');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- DB にはハッシュだけが保存され、トークン本体は残らない
reset role;
do $$
begin
  assert (select count(*) from group_invites where group_id = current_setting('test.f_group')::uuid) = 2, '発行履歴は2件';
  assert (select count(*) from group_invites where group_id = current_setting('test.f_group')::uuid and revoked_at is null) = 1, '有効なのは1件';
  assert not exists (select 1 from group_invites where token_hash in (current_setting('test.f_token'), current_setting('test.f_old'))), 'トークン本体は保存しない';
  assert exists (select 1 from group_invites where token_hash = invite_token_hash(current_setting('test.f_token')) and revoked_at is null), 'ハッシュで保存する';
end $$;

-- F2: 古いトークンでは参加できず、新しいトークンで参加できる
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f2', false);
do $$
declare g groups;
begin
  g := join_group_with_invite(current_setting('test.f_old'));
  assert g is null, '再発行前のトークンは使えない';
  g := join_group_with_invite(current_setting('test.f_token'));
  assert g.name = 'F家', '有効なトークンで参加できる';
  assert my_group_id() = current_setting('test.f_group')::uuid, 'F家のメンバーになる';
  -- 参加したメンバーも招待を無効化できる
  perform revoke_group_invite();
end $$;

-- F3: 無効化されたトークンでは参加できない。失敗が続くとレート制限がかかる
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f3', false);
do $$
declare
  g groups;
  i int;
begin
  g := join_group_with_invite(current_setting('test.f_token'));
  assert g is null, '無効化したトークンは使えない';
  for i in 1..9 loop
    g := join_group_with_invite('wrong-' || i);
    assert g is null;
  end loop;
  begin
    perform join_group_with_invite('wrong-again');
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm like '招待リンクの確認に失敗した回数が多すぎます%', sqlerrm;
  end;
end $$;

-- 期限切れ: F1 が再発行したトークンの期限を過去にすると使えない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f1', false);
do $$
begin
  perform set_config('test.f_token3', (select invite_token from create_group_invite()), false);
end $$;
reset role;
update group_invites set expires_at = now() - interval '1 minute'
where group_id = current_setting('test.f_group')::uuid and revoked_at is null;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f4', false);
do $$
declare g groups;
begin
  g := join_group_with_invite(current_setting('test.f_token3'));
  assert g is null, '期限切れのトークンは使えない';
  assert my_group_id() is null, '参加していない';
end $$;

-- 未ログイン(anon)は RPC を実行できない
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  begin
    perform join_group_with_invite('x');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_group_invite();
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 旧コードの値は消え、クライアントは invite_code 列を読めない(migration 011)
reset role;
do $$
begin
  assert not exists (select 1 from groups where invite_code is not null), '旧コードの値は残っていない';
  assert not has_column_privilege('authenticated', 'public.groups', 'invite_code', 'SELECT'), 'invite_code は読めない';
  assert has_column_privilege('authenticated', 'public.groups', 'name', 'SELECT'), 'name は読める';
end $$;

\echo 'invites.test.sql: all assertions passed'
