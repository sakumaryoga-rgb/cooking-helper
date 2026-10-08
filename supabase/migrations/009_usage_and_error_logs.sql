-- COOKDOOR v1.1.0: 利用状況(ページビュー)とクライアントエラーの記録
--
-- 方針
-- - クライアントから書けるのは「ログイン中の本人の行の INSERT」だけ。SELECT / UPDATE / DELETE は
--   権限ごと与えない。集計は SQL Editor(postgres ロール)から行う。
-- - user_id と created_at はクライアントが指定できない(列単位の INSERT 権限から外し、既定値で決まる)。
-- - group_id は本人の所属グループ(my_group_id())か null だけを許す。
-- - 料理の内容、レシピの URL、メールアドレス、トークン、入力内容は保存しない。
--   画面側で伏せ字にしたうえで、DB 側でも形式と長さを制限する。
-- - 保存期間は 90 日。purge_usage_and_error_logs() で削除する(pg_cron が有効なら毎日自動)。
--
-- 何度実行しても同じ結果になるように書いている。SQL Editor で全体をそのまま実行する。

-- ------------------------------------------------------------
-- 1. ページビュー
-- ------------------------------------------------------------
create table if not exists page_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid(),
  group_id uuid references groups(id) on delete set null,
  app_version text not null,
  path text not null,
  constraint page_views_app_version_format check (app_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  constraint page_views_path_format check (char_length(path) <= 64 and path ~ '^/[a-z/:-]*$')
);

-- ------------------------------------------------------------
-- 2. クライアントエラー
-- ------------------------------------------------------------
create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid(),
  group_id uuid references groups(id) on delete set null,
  app_version text not null,
  path text not null,
  kind text not null,
  message text not null,
  stack text,
  fingerprint text not null,
  constraint client_errors_app_version_format check (app_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  constraint client_errors_path_format check (char_length(path) <= 64 and path ~ '^/[a-z/:-]*$'),
  constraint client_errors_kind check (kind in ('error', 'unhandledrejection')),
  constraint client_errors_message_length check (char_length(message) between 1 and 500),
  constraint client_errors_stack_length check (stack is null or char_length(stack) <= 2000),
  constraint client_errors_fingerprint_format check (fingerprint ~ '^[0-9a-f]{8}$')
);

-- ------------------------------------------------------------
-- 3. 権限: INSERT(許可した列だけ)以外は与えない
-- ------------------------------------------------------------
revoke all on table page_views from anon, authenticated;
revoke all on table client_errors from anon, authenticated;
grant insert (group_id, app_version, path) on table page_views to authenticated;
grant insert (group_id, app_version, path, kind, message, stack, fingerprint) on table client_errors to authenticated;

-- ------------------------------------------------------------
-- 4. RLS: 本人の行で、所属グループか null の group_id だけ
-- ------------------------------------------------------------
alter table page_views enable row level security;
alter table client_errors enable row level security;

drop policy if exists "insert own page view" on page_views;
create policy "insert own page view" on page_views
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (group_id is null or group_id = my_group_id())
  );

drop policy if exists "insert own client error" on client_errors;
create policy "insert own client error" on client_errors
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (group_id is null or group_id = my_group_id())
  );

-- ------------------------------------------------------------
-- 5. 集計と削除のためのインデックス
-- ------------------------------------------------------------
create index if not exists page_views_created_at_idx on page_views (created_at);
create index if not exists page_views_user_created_idx on page_views (user_id, created_at);
create index if not exists page_views_group_created_idx on page_views (group_id, created_at);
create index if not exists page_views_path_created_idx on page_views (path, created_at);
create index if not exists client_errors_created_at_idx on client_errors (created_at);
create index if not exists client_errors_fingerprint_created_idx on client_errors (fingerprint, created_at);

-- ------------------------------------------------------------
-- 6. 90日を超えた記録の削除
-- ------------------------------------------------------------
create or replace function purge_usage_and_error_logs(retention interval default interval '90 days')
returns table (purged_page_views bigint, purged_client_errors bigint)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_page_views bigint;
  v_client_errors bigint;
begin
  if retention < interval '1 day' then
    raise exception '保存期間が短すぎます';
  end if;
  delete from page_views where created_at < now() - retention;
  get diagnostics v_page_views = row_count;
  delete from client_errors where created_at < now() - retention;
  get diagnostics v_client_errors = row_count;
  return query select v_page_views, v_client_errors;
end;
$$;

-- クライアントからは実行させない(SQL Editor と pg_cron からだけ)
revoke all on function purge_usage_and_error_logs(interval) from public, anon, authenticated;

-- 自動削除の登録。拡張機能の有効化はこの migration では行わない(失敗して適用全体が止まるのを避けるため)。
-- pg_cron がすでに有効なら毎日 3:30 UTC(日本時間 12:30)の実行を登録し、無効なら何もしない。
-- 後から pg_cron を有効にした場合は supabase/manual/009_schedule_purge.sql を実行する。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $sql$
      select cron.unschedule(jobid) from cron.job where jobname = 'purge-usage-and-error-logs'
    $sql$;
    execute $sql$
      select cron.schedule('purge-usage-and-error-logs', '30 3 * * *', 'select * from public.purge_usage_and_error_logs()')
    $sql$;
  else
    raise notice 'pg_cron が無効なため、90日削除の自動実行は登録していません';
  end if;
end $$;
