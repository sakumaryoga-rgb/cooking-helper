-- migration 018(運営者の無効化、お問い合わせの通知、管理画面の集計)のテスト。合成データのみ。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000bb01'),  -- 運営者(あとで無効化)
  ('00000000-0000-4000-8000-00000000bb02');  -- 一般の利用者
insert into app_admins (user_id) values ('00000000-0000-4000-8000-00000000bb01');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000bb02', false);
do $$
begin
  perform create_group('通知の家');
  assert submit_contact('bug', '通知のテスト用のお問い合わせです。その1', 'n@example.com', '1.9.0', '', 5000) = 'ok';
  assert submit_contact('bug', '通知のテスト用のお問い合わせです。その2', null, '1.9.0', '', 5000) = 'ok';
  -- 一般の利用者は通知の関数を使えない
  begin
    perform claim_contact_notifications(10);
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform mark_contact_notification(gen_random_uuid(), true, null);
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  assert admin_retry_contact_notification(gen_random_uuid()) = 'forbidden';
end $$;

-- サーバー(service_role)が通知を取り出す: 同じものを2回取り出さない。返信先は返さない
reset role;
set role service_role;
do $$
declare
  first_ids uuid[];
  n int;
  rec record;
begin
  select array_agg(contact_id) into first_ids from claim_contact_notifications(10);
  assert array_length(first_ids, 1) >= 2, '未通知の2件を取り出す';
  select count(*) into n from claim_contact_notifications(10) where contact_id = any(first_ids);
  assert n = 0, '送信中のものは2回取り出さない';
  for rec in select * from claim_contact_notifications(10) loop
    assert rec.contact_body not like '%@%', '返信先は含めない';
  end loop;

  perform mark_contact_notification(first_ids[1], true, null);
  perform mark_contact_notification(first_ids[2], false, 'webhook 500');
  perform set_config('test.ok_id', first_ids[1]::text, false);
  perform set_config('test.ng_id', first_ids[2]::text, false);

  -- 次の取り出し: 通知済みは出ず、失敗したものは再び出る
  create temp table next_claim as select * from claim_contact_notifications(10);
  assert not exists (select 1 from next_claim where contact_id = first_ids[1]), '通知済みは取り出さない';
  assert exists (select 1 from next_claim where contact_id = first_ids[2]), '失敗したものは次の通知で再び取り出す';
  perform mark_contact_notification(first_ids[2], false, 'webhook 500');
end $$;

-- 5回失敗したら自動では取り出さない。運営者の「再通知」で戻る
reset role;
update contact_messages set notify_attempts = 5 where id = current_setting('test.ng_id')::uuid;
set role service_role;
do $$
begin
  assert not exists (select 1 from claim_contact_notifications(10) where contact_id = current_setting('test.ng_id')::uuid), '5回失敗したら止める';
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000bb01', false);
do $$
declare r jsonb;
begin
  r := admin_dashboard(30);
  assert r ->> 'error' is null, r::text;
  assert (r -> 'contact_counts' ->> 'open')::int >= 2, '未対応の件数';
  assert (r -> 'contact_counts' ->> 'notify_failed')::int >= 1, '通知に失敗した件数';
  assert (r -> 'retention' ->> 'page_views_overdue') is not null, '保存期間を過ぎた件数';
  assert exists (select 1 from jsonb_array_elements(r -> 'contacts') c where c ->> 'notify_error' = 'webhook 500'), '失敗の理由が見える';
  assert admin_retry_contact_notification(current_setting('test.ng_id')::uuid) = 'ok';
end $$;
reset role;
do $$
begin
  assert (select notify_attempts from contact_messages where id = current_setting('test.ng_id')::uuid) = 0, '再通知で試行回数が戻る';
  -- 運営者を無効化する
  update app_admins set disabled_at = now() where user_id = '00000000-0000-4000-8000-00000000bb01';
end $$;

-- 無効化された運営者は管理用 RPC を使えない
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000bb01', false);
do $$
begin
  assert not is_app_admin(), '無効化後は運営者ではない';
  assert admin_dashboard(30) ->> 'error' = 'forbidden', '無効化後は集計を返さない';
end $$;

reset role;
\echo 'operations.test.sql: all assertions passed'
