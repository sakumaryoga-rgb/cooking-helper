-- migration 019(通知の起動を本人の直近のお問い合わせに限る)のテスト。合成データのみ。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000cc01'),
  ('00000000-0000-4000-8000-00000000cc02');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000cc01', false);
do $$
begin
  perform create_group('通知範囲の家1');
  assert submit_contact('bug', '本人が送ったお問い合わせの本文です。', 'p@example.com', '1.9.2', '', 5000) = 'ok';
  -- 一般の利用者は直接呼べない
  begin
    perform claim_own_contact_notifications(auth.uid());
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000cc02', false);
do $$
begin
  perform create_group('通知範囲の家2');
  assert submit_contact('question', '別の利用者のお問い合わせの本文です。', null, '1.9.2', '', 5000) = 'ok';
end $$;

reset role;
-- 10分より前のお問い合わせ(別の利用者 cc02 の古いもの)を作る
insert into contact_messages (user_id, category, body, body_hash, created_at)
values ('00000000-0000-4000-8000-00000000cc01', 'other', '古いお問い合わせの本文です。', 'x', now() - interval '20 minutes');

set role service_role;
do $$
declare
  rows_ record;
  n int := 0;
begin
  for rows_ in select * from claim_own_contact_notifications('00000000-0000-4000-8000-00000000cc01') loop
    n := n + 1;
    assert rows_.contact_category = 'bug', '本人の直近のお問い合わせだけ';
  end loop;
  assert n = 1, '本人の10分以内の1件だけ(他人のもの・古いものは出ない)';
  assert not exists (select 1 from claim_own_contact_notifications('00000000-0000-4000-8000-00000000cc01')), '繰り返し呼んでも同じものは出ない';
  assert not exists (select 1 from claim_own_contact_notifications(null)), 'ID がなければ何も出ない';
end $$;

reset role;
\echo 'notify_scope.test.sql: all assertions passed'
