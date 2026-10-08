-- migration 016(規約への同意、お問い合わせ、運営者権限、取り込みの記録)のテスト。合成データのみ。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000ad01'),  -- 運営者
  ('00000000-0000-4000-8000-00000000ad02'),  -- 一般の利用者 U
  ('00000000-0000-4000-8000-00000000ad03');  -- 別の家庭の利用者 V
insert into app_admins (user_id, note) values ('00000000-0000-4000-8000-00000000ad01', 'テスト用の運営者');

-- 一般の利用者 U
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ad02', false);
do $$
declare
  r jsonb;
  t text;
  i int;
begin
  perform create_group('U家');

  -- 規約への同意: 自分の分だけ記録・参照できる
  insert into user_consents (document, version) values ('terms', 'draft-2026-10-08'), ('privacy', 'draft-2026-10-08');
  assert (select count(*) from user_consents) = 2, '自分の同意が2件見える';
  begin
    insert into user_consents (user_id, document, version) values ('00000000-0000-4000-8000-00000000ad03', 'terms', 'x');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into user_consents (document, version) values ('terms', 'draft-2026-10-08');
    raise exception 'should have failed';
  exception when unique_violation then null;
  end;
  begin
    update user_consents set version = 'x';
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;

  -- お問い合わせ: 送れるが、自分のものも読めない
  t := submit_contact('question', '使い方を教えてください。よろしくお願いします。', 'u@example.com', '1.8.0', '', 5000);
  assert t = 'ok', t;
  begin
    perform count(*) from contact_messages;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  -- 重複・入力チェック
  assert submit_contact('question', '使い方を教えてください。よろしくお願いします。', null, '1.8.0', '', 5000) = 'duplicate', '同じ本文は1日に1回';
  begin
    perform submit_contact('question', '短い', null, '1.8.0', '', 5000);
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    perform submit_contact('spam', '種別が正しくない問い合わせです。', null, '1.8.0', '', 5000);
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  begin
    perform submit_contact('bug', 'メールアドレスが正しくない問い合わせです。', 'not-an-email', '1.8.0', '', 5000);
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  -- ボット対策: 隠し欄の入力・3秒未満は保存しない(結果は ok)
  assert submit_contact('other', 'ボットが送った問い合わせの本文です。', null, '1.8.0', 'http://spam', 5000) = 'ok';
  assert submit_contact('other', 'すぐに送られた問い合わせの本文です。', null, '1.8.0', '', 500) = 'ok';
  -- 送信回数: 10分に3件まで
  assert submit_contact('request', '機能の要望その1です。よろしくお願いします。', null, '1.8.0', '', 5000) = 'ok';
  assert submit_contact('request', '機能の要望その2です。よろしくお願いします。', null, '1.8.0', '', 5000) = 'ok';
  assert submit_contact('request', '機能の要望その3です。よろしくお願いします。', null, '1.8.0', '', 5000) = 'rate_limited', '4件目は制限';

  -- 取り込みの記録: 書けるが読めない
  insert into recipe_import_runs (site, outcome) values ('delishkitchen', 'success'), ('nadia', 'fetch_failed');
  begin
    perform count(*) from recipe_import_runs;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;

  -- 管理用: 運営者でなければ集計も更新もできず、5回で締め出される
  assert not is_app_admin(), '運営者ではない';
  for i in 1..5 loop
    r := admin_dashboard(30);
    assert r ->> 'error' = 'forbidden', r::text;
    assert r -> 'contacts' is null, '問い合わせは返らない';
  end loop;
  assert admin_dashboard(30) ->> 'error' = 'locked', '6回目からは締め出し';
  assert admin_update_contact(gen_random_uuid(), 'closed', 'x') = 'locked';
  begin
    perform count(*) from app_admins;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into app_admins (user_id) values (auth.uid());
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform admin_gate();
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform purge_contact_emails();
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 別の家庭の利用者 V は U の同意を見られない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ad03', false);
do $$
begin
  perform create_group('V家');
  insert into ingredients (group_id, name, unit, quantity) values (my_group_id(), 'Vの食材', '個', 3);
  assert (select count(*) from user_consents) = 0, '他人の同意は見えない';
end $$;

-- 運営者: 集計とお問い合わせを読め、対応状況を更新できる。家庭の在庫・レシピは読めない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ad01', false);
do $$
declare
  r jsonb;
  c uuid;
begin
  assert is_app_admin(), '運営者';
  r := admin_dashboard(30);
  assert r ->> 'error' is null, r::text;
  assert jsonb_array_length(r -> 'contacts') = 3, '保存された問い合わせは3件(ボット・制限分は除く)';
  assert (select count(*) from jsonb_array_elements(r -> 'imports')) = 2, '取り込みの集計はサイト別に2行';
  assert exists (select 1 from jsonb_array_elements(r -> 'imports') x where x ->> 'site' = 'delishkitchen' and (x ->> 'success')::int = 1);
  c := ((r -> 'contacts') -> 0 ->> 'id')::uuid;
  assert admin_update_contact(c, 'closed', '回答済み') = 'ok';
  assert (admin_dashboard(30) -> 'contacts') @> jsonb_build_array(jsonb_build_object('id', c, 'status', 'closed', 'admin_note', '回答済み'));
  -- 運営者でも、各家庭の在庫は RLS で見えない(管理用の RPC は在庫・レシピを返さない)
  assert (select count(*) from ingredients) = 0, '運営者でも他の家庭の在庫は見えない';
  assert r::text not like '%Vの食材%', '集計に在庫の名前は含まれない';
end $$;

-- 90日を過ぎた返信先メールアドレスは消える(本文は残る)
reset role;
do $$
begin
  update contact_messages set created_at = now() - interval '91 days' where reply_email = 'u@example.com';
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000ad01', false);
  assert (admin_dashboard(30) ->> 'emails_overdue')::int = 1, '削除前は「90日を過ぎて未削除」が1件と分かる';
  assert purge_contact_emails() = 1, '1件消す';
  assert (admin_dashboard(30) ->> 'emails_overdue')::int = 0, '削除後は0件';
  assert exists (select 1 from contact_messages where reply_email is null and email_purged_at is not null and body like '使い方%'), '本文は残る';
end $$;

\echo 'launch.test.sql: all assertions passed'
