-- migration 031(取り込みの失敗の記録・汎用の読み取りの記録)のテスト。合成データのみ
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000ff501'),  -- 利用者
  ('00000000-0000-4000-8000-0000000ff502');  -- 運営者
insert into app_admins (user_id) values ('00000000-0000-4000-8000-0000000ff502');

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

set role authenticated;
select set_config('request.headers', '', false);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff501', false);

-- 1. 利用者の権限で失敗を記録できる(読めない・変えられない・消せない)
insert into recipe_import_failures (site, host, path, reason, http_status, features)
values ('generic', 'blog.example.com', '/recipes/hamburg', 'no_recipe_data', 200, '{"ld_types": ["Article"], "microdata": false}');
insert into recipe_import_failures (site, host, path, reason) values ('generic', 'blog.example.com', '/recipes/curry', 'robots_disallowed');
insert into recipe_import_failures (site, host, path, reason, http_status) values ('kurashiru', 'www.kurashiru.com', '/recipes/x', 'fetch_status', 404);
do $$
begin
  assert pg_temp.err('select count(*) from recipe_import_failures') is not null, '利用者は読めない';
  assert pg_temp.err('update recipe_import_failures set reason = ''fetch_error''') is not null, '変更できない';
  assert pg_temp.err('delete from recipe_import_failures') is not null, '削除できない';
  -- 他人の user_id では記録できない
  assert pg_temp.err('insert into recipe_import_failures (user_id, site, host, path, reason) values (''00000000-0000-4000-8000-0000000ff502'', ''generic'', ''a.example'', ''/x'', ''fetch_error'')') is not null, '他人として記録できない';
  -- 形の制約
  assert pg_temp.err('insert into recipe_import_failures (site, host, path, reason) values (''generic'', ''a.example'', ''/x?token=1'', ''fetch_error'')') is not null, 'クエリ文字列は記録しない';
  assert pg_temp.err('insert into recipe_import_failures (site, host, path, reason) values (''generic'', ''A.Example'', ''/x'', ''fetch_error'')') is not null, 'ドメインは小文字';
  assert pg_temp.err('insert into recipe_import_failures (site, host, path, reason) values (''generic'', ''a.example'', ''/x'', ''unknown'')') is not null, '理由は決まったもの';
  assert pg_temp.err(format('insert into recipe_import_failures (site, host, path, reason, features) values (%L, %L, %L, %L, %L::jsonb)',
    'generic', 'a.example', '/x', 'fetch_error', jsonb_build_object('big', repeat('x', 3000)))) is not null, 'ページの特徴は小さく';
end $$;

-- 2. 取り込みの記録: 汎用の読み取り(generic)と読み取れた方法、blocked
insert into recipe_import_runs (site, outcome, method) values ('generic', 'success', 'microdata');
insert into recipe_import_runs (site, outcome, method) values ('kurashiru', 'success', 'jsonld');
insert into recipe_import_runs (site, outcome) values ('generic', 'blocked');
do $$
begin
  assert pg_temp.err('insert into recipe_import_runs (site, outcome, method) values (''generic'', ''success'', ''guess'')') is not null, '方法は決まったもの';
  assert (select admin_import_failures(30) ->> 'error') = 'forbidden', '利用者は集計を見られない';
end $$;

-- 3. 運営者はドメインと理由ごとの集計と最近の例を見られる。180日を過ぎた記録は消える
reset role;
insert into recipe_import_failures (created_at, user_id, site, host, path, reason)
values (now() - interval '200 days', '00000000-0000-4000-8000-0000000ff501', 'generic', 'old.example', '/x', 'fetch_error');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff502', false);
do $$
declare
  v jsonb := admin_import_failures(30);
  top jsonb := v -> 'by_host' -> 0;
begin
  assert v ->> 'error' is null, '運営者は見られる';
  assert top ->> 'host' = 'blog.example.com' and (top ->> 'count')::int = 2, 'ドメインごとの件数(多い順)';
  assert top -> 'reasons' = '{"no_recipe_data": 1, "robots_disallowed": 1}'::jsonb, '理由ごとの件数';
  assert jsonb_array_length(v -> 'recent') = 3, '最近の例';
  assert (v -> 'recent' -> 0) ? 'features', 'ページの特徴を返す';
  assert exists (select 1 from jsonb_array_elements(v -> 'methods') m where m ->> 'site' = 'generic' and m ->> 'method' = 'microdata'), '読み取れた方法の集計';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from recipe_import_failures where host = 'old.example'), '180日を過ぎた記録は消える';
end $$;

\echo 'recipe_import_failures.test.sql: all assertions passed'
