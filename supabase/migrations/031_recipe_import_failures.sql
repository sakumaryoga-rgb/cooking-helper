-- 031: レシピ取り込みの失敗の記録(取り込めなかったページの形を残し、次に読めるよう読み取りを直すため)と、
--      対応サイト以外のページ(汎用の読み取り)の取り込みの記録
--
-- 何度実行しても同じ結果になる。既存のデータは削除・変更しない。
-- 1. recipe_import_runs: method(読み取れた方法: jsonld / microdata / heuristic)を追加。outcome に blocked
--    (robots.txt で禁止・取得してはいけない宛先)を追加。site は対応サイトの id か generic(汎用の読み取り)
-- 2. recipe_import_failures: 失敗の記録。Vercel Function が利用者の権限で追加だけする(利用者は読めない)
--    - 記録するのはドメインとパス(クエリ文字列は記録しない)、失敗の理由、HTTP の状態、ページの特徴
--      (JSON-LD の @type の一覧、microdata の有無など。本文・画像・手順は記録しない)
--    - 180日を過ぎた記録は、運営者が集計を開いたときに消す(pg_cron が無効のため)
-- 3. admin_import_failures(p_days): 運営者だけ。失敗をドメインと理由ごとに集計し、最近の例を返す

alter table recipe_import_runs add column if not exists method text;
alter table recipe_import_runs drop constraint if exists recipe_import_runs_outcome;
alter table recipe_import_runs add constraint recipe_import_runs_outcome
  check (outcome in ('success', 'fetch_failed', 'no_recipe_data', 'blocked'));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipe_import_runs_method') then
    alter table recipe_import_runs add constraint recipe_import_runs_method
      check (method is null or method in ('jsonld', 'microdata', 'heuristic'));
  end if;
end $$;
grant insert (site, outcome, method) on table recipe_import_runs to authenticated;

create table if not exists recipe_import_failures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  site text not null,
  host text not null,
  path text not null,
  reason text not null,
  http_status int,
  features jsonb not null default '{}'::jsonb,
  constraint recipe_import_failures_site check (site ~ '^[a-z]{1,20}$'),
  constraint recipe_import_failures_host check (host ~ '^[a-z0-9.-]{1,253}$'),
  constraint recipe_import_failures_path check (char_length(path) between 1 and 300 and path like '/%' and position('?' in path) = 0),
  constraint recipe_import_failures_reason check (reason in (
    'blocked_host', 'robots_disallowed', 'fetch_status', 'fetch_type', 'fetch_size', 'fetch_redirect',
    'fetch_timeout', 'fetch_error', 'no_recipe_data', 'recipe_no_ingredients')),
  constraint recipe_import_failures_status check (http_status is null or http_status between 100 and 599),
  constraint recipe_import_failures_features check (jsonb_typeof(features) = 'object' and pg_column_size(features) <= 2000)
);
create index if not exists recipe_import_failures_created_idx on recipe_import_failures (created_at);
alter table recipe_import_failures enable row level security;
revoke all on table recipe_import_failures from anon, authenticated;
grant insert (site, host, path, reason, http_status, features) on table recipe_import_failures to authenticated;
drop policy if exists "insert own import failures" on recipe_import_failures;
create policy "insert own import failures" on recipe_import_failures
  for insert to authenticated with check (user_id = auth.uid());

-- 運営者の集計(取り込めなかったドメインと理由。最近の例はパスとページの特徴まで)
create or replace function admin_import_failures(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_gate text := admin_gate();
  v_days int := least(greatest(coalesce(p_days, 30), 1), 180);
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  if v_gate <> 'ok' then
    return jsonb_build_object('error', v_gate);
  end if;
  delete from recipe_import_failures where created_at < now() - interval '180 days';
  return jsonb_build_object(
    'days', v_days,
    'by_host', coalesce((
      select jsonb_agg(h order by (h->>'count')::int desc) from (
        select jsonb_build_object('host', f.host, 'count', count(*), 'users', count(distinct f.user_id), 'last_seen', max(f.created_at),
                                  'reasons', (select jsonb_object_agg(r.reason, r.n) from (
                                    select f2.reason, count(*) as n from recipe_import_failures f2
                                    where f2.host = f.host and f2.created_at >= v_since group by f2.reason) r)) h
        from recipe_import_failures f where f.created_at >= v_since
        group by f.host order by count(*) desc limit 30) y), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(m) from (
        select jsonb_build_object('site', site, 'method', method, 'count', count(*)) m
        from recipe_import_runs where outcome = 'success' and created_at >= v_since group by site, method) z), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r order by r->>'created_at' desc) from (
        select jsonb_build_object('created_at', created_at, 'site', site, 'host', host, 'path', path, 'reason', reason,
                                  'http_status', http_status, 'features', features) r
        from recipe_import_failures where created_at >= v_since order by created_at desc limit 50) w), '[]'::jsonb)
  );
end;
$$;
revoke all on function admin_import_failures(int) from public, anon;
grant execute on function admin_import_failures(int) to authenticated;
