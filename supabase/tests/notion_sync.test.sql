-- migration 020(Notion への登録の記録)のテスト。合成データのみ。

reset role;
insert into auth.users (id) values ('00000000-0000-4000-8000-00000000dd01'), ('00000000-0000-4000-8000-00000000dd02');
insert into app_admins (user_id) values ('00000000-0000-4000-8000-00000000dd02') on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000dd01', false);
do $$
begin
  perform create_group('Notionの家');
  assert submit_contact('bug', 'Notion に登録するお問い合わせです。', 'n@example.com', '1.10.0', '', 5000) = 'ok';
  begin
    perform mark_contact_notion_sync(gen_random_uuid(), '0123456789abcdef0123456789abcdef', null);
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set role service_role;
do $$
declare
  c uuid;
begin
  select contact_id into c from claim_own_contact_notifications('00000000-0000-4000-8000-00000000dd01') limit 1;
  assert c is not null, '本人の直近のお問い合わせを取り出す';
  perform set_config('test.c', c::text, false);
  -- 失敗: 理由を記録し、処理中の印を外す(再送できる)
  perform mark_contact_notion_sync(c, null, 'Notion API error: 401');
  assert (select notify_error from contact_messages where id = c) = 'Notion API error: 401';
  assert (select notify_claimed_at is null and notified_at is null from contact_messages where id = c), '未登録のまま';
  -- 成功: ページ ID と登録日時
  perform mark_contact_notion_sync(c, '0123456789abcdef0123456789abcdef', null);
  assert (select notion_page_id = '0123456789abcdef0123456789abcdef' and notified_at is not null and notify_error is null from contact_messages where id = c);
  assert not exists (select 1 from claim_contact_notifications(10) where contact_id = c), '登録済みは取り出さない';
end $$;

reset role;
do $$
begin
  -- 同じページ ID を別のお問い合わせに付けられない(二重登録の検出)
  begin
    insert into contact_messages (user_id, category, body, body_hash, notion_page_id)
    values ('00000000-0000-4000-8000-00000000dd01', 'other', '別のお問い合わせの本文です。', 'y', '0123456789abcdef0123456789abcdef');
    raise exception 'should have failed';
  exception when unique_violation then null;
  end;
end $$;

-- 管理画面にページ ID が出る
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000dd02', false);
do $$
begin
  assert exists (select 1 from jsonb_array_elements(admin_dashboard(30) -> 'contacts') x
                 where x ->> 'notion_page_id' = '0123456789abcdef0123456789abcdef'), '管理画面に Notion のページ ID';
end $$;

reset role;
\echo 'notion_sync.test.sql: all assertions passed'
