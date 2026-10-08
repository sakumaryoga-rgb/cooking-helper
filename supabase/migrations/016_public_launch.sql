-- COOKDOOR v1.8.0(Phase 7): 一般公開の準備
--
-- 1. user_consents: 利用規約・プライバシーポリシーへの同意履歴(文書・版・日時)。本人だけが読み書きする。
-- 2. contact_messages + submit_contact(): お問い合わせ。送信は RPC だけ(入力チェック、送信回数制限、
--    重複の防止、ボット対策)。利用者は自分のものも含めて読めない。返信先メールアドレスは90日で消す。
-- 3. app_admins + is_app_admin() + admin_* RPC: 運営者の権限をサーバー側(DB)で確かめる。
--    運営者でない呼び出しは記録し、1時間に5回を超えたら拒否する。管理用の RPC は集計の読み取りと、
--    お問い合わせの対応状況の更新だけを行い、各家庭の在庫・レシピは変更しない。
-- 4. recipe_import_runs: レシピ URL 取り込みの実行結果(成功率の計測。過去分はない)。
--
-- 既存のテーブル・データは変更しない。何度実行しても同じ結果になる。SQL Editor で全体をそのまま実行する。
-- 運営者の登録はこの migration では行わない(docs/release-v1.8.0.md の SQL で別に行う)。

-- ------------------------------------------------------------
-- 1. 規約への同意
-- ------------------------------------------------------------
create table if not exists user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document text not null,
  version text not null,
  agreed_at timestamptz not null default now(),
  constraint user_consents_document check (document in ('terms', 'privacy')),
  constraint user_consents_version_format check (version ~ '^[0-9a-z.-]{1,40}$')
);
create unique index if not exists user_consents_user_doc_version_idx on user_consents (user_id, document, version);

alter table user_consents enable row level security;
revoke all on table user_consents from anon, authenticated;
grant select on table user_consents to authenticated;
grant insert (document, version) on table user_consents to authenticated;
drop policy if exists "read own consents" on user_consents;
drop policy if exists "insert own consents" on user_consents;
create policy "read own consents" on user_consents for select to authenticated using (user_id = auth.uid());
create policy "insert own consents" on user_consents for insert to authenticated with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 2. お問い合わせ
-- ------------------------------------------------------------
create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  group_id uuid references groups(id) on delete set null,
  app_version text,
  category text not null,
  body text not null,
  body_hash text not null,
  reply_email text,
  email_purged_at timestamptz,
  status text not null default 'open',
  admin_note text,
  handled_at timestamptz,
  notified_at timestamptz,
  constraint contact_messages_category check (category in ('question', 'bug', 'request', 'account', 'other')),
  constraint contact_messages_body_length check (char_length(body) between 10 and 2000),
  constraint contact_messages_email_format check (reply_email is null or (char_length(reply_email) <= 254 and reply_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint contact_messages_status check (status in ('open', 'in_progress', 'closed')),
  constraint contact_messages_note_length check (admin_note is null or char_length(admin_note) <= 1000)
);
create index if not exists contact_messages_created_idx on contact_messages (created_at desc);
create index if not exists contact_messages_user_created_idx on contact_messages (user_id, created_at);

alter table contact_messages enable row level security;
revoke all on table contact_messages from anon, authenticated;
-- ポリシーは作らない(利用者は読み書きできない。送信は submit_contact、閲覧と更新は admin_* RPC)

-- 戻り値: 'ok' / 'rate_limited' / 'duplicate'(例外にしないのは、送信回数の記録を残すため)
create or replace function submit_contact(
  p_category text,
  p_body text,
  p_reply_email text,
  p_app_version text,
  p_honeypot text,
  p_elapsed_ms int
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_email text := nullif(lower(btrim(coalesce(p_reply_email, ''))), '');
  v_hash text;
begin
  if v_user is null then
    raise exception '権限がありません';
  end if;
  -- ボット対策: 隠し欄が入力されている、または画面を開いてから3秒未満の送信は、保存せずに成功を返す
  if coalesce(p_honeypot, '') <> '' or coalesce(p_elapsed_ms, 0) < 3000 then
    return 'ok';
  end if;
  -- 送信回数: 10分に3件、1日に10件まで
  if (select count(*) from contact_messages where user_id = v_user and created_at > now() - interval '10 minutes') >= 3
     or (select count(*) from contact_messages where user_id = v_user and created_at > now() - interval '1 day') >= 10 then
    return 'rate_limited';
  end if;
  v_hash := encode(extensions.digest(convert_to(v_body, 'UTF8'), 'sha256'), 'hex');
  if exists (select 1 from contact_messages where user_id = v_user and body_hash = v_hash and created_at > now() - interval '1 day') then
    return 'duplicate';
  end if;

  insert into contact_messages (user_id, group_id, app_version, category, body, body_hash, reply_email)
  values (v_user, my_group_id(), left(p_app_version, 20), p_category, v_body, v_hash, v_email);
  return 'ok';
end;
$$;
revoke all on function submit_contact(text, text, text, text, text, int) from public, anon;
grant execute on function submit_contact(text, text, text, text, text, int) to authenticated;

-- 90日を過ぎた返信先メールアドレスを消す(本文は対応記録として残す)
create or replace function purge_contact_emails()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count bigint;
begin
  update contact_messages set reply_email = null, email_purged_at = now()
  where reply_email is not null and created_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function purge_contact_emails() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. レシピ URL 取り込みの実行記録(Vercel Function が利用者の権限で書く)
-- ------------------------------------------------------------
create table if not exists recipe_import_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  site text not null,
  outcome text not null,
  constraint recipe_import_runs_site check (site ~ '^[a-z]{1,20}$'),
  constraint recipe_import_runs_outcome check (outcome in ('success', 'fetch_failed', 'no_recipe_data'))
);
create index if not exists recipe_import_runs_created_idx on recipe_import_runs (created_at);
alter table recipe_import_runs enable row level security;
revoke all on table recipe_import_runs from anon, authenticated;
grant insert (site, outcome) on table recipe_import_runs to authenticated;
drop policy if exists "insert own import runs" on recipe_import_runs;
create policy "insert own import runs" on recipe_import_runs for insert to authenticated with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 4. 運営者の権限
-- ------------------------------------------------------------
create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);
alter table app_admins enable row level security;
revoke all on table app_admins from anon, authenticated;

create table if not exists admin_access_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_access_attempts_user_created_idx on admin_access_attempts (user_id, created_at);
alter table admin_access_attempts enable row level security;
revoke all on table admin_access_attempts from anon, authenticated;

-- 自分が運営者かどうかだけを返す(他人については分からない)
create or replace function is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;
revoke all on function is_app_admin() from public, anon;
grant execute on function is_app_admin() to authenticated;

-- 管理用 RPC の入口。運営者でなければ試行を記録して 'forbidden'、1時間に5回を超えたら 'locked'
create or replace function admin_gate()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return 'forbidden';
  end if;
  if (select count(*) from admin_access_attempts where user_id = v_user and created_at > now() - interval '1 hour') >= 5 then
    return 'locked';
  end if;
  if exists (select 1 from app_admins where user_id = v_user) then
    return 'ok';
  end if;
  insert into admin_access_attempts (user_id) values (v_user);
  delete from admin_access_attempts where created_at < now() - interval '1 day';
  return 'forbidden';
end;
$$;
revoke all on function admin_gate() from public, anon, authenticated;

-- 管理画面の集計(読み取りのみ)。日付は日本時間
create or replace function admin_dashboard(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_gate text := admin_gate();
  v_days int := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  if v_gate <> 'ok' then
    return jsonb_build_object('error', v_gate);
  end if;
  return jsonb_build_object(
    'days', v_days,
    'daily', coalesce((
      select jsonb_agg(d order by d->>'day') from (
        select jsonb_build_object('day', (created_at at time zone 'Asia/Tokyo')::date, 'page_views', count(*),
                                  'users', count(distinct user_id), 'groups', count(distinct group_id)) d
        from page_views where created_at >= v_since group by (created_at at time zone 'Asia/Tokyo')::date) x), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(m order by m->>'month') from (
        select jsonb_build_object('month', to_char(created_at at time zone 'Asia/Tokyo', 'YYYY-MM'), 'users', count(distinct user_id),
                                  'groups', count(distinct group_id), 'page_views', count(*)) m
        from page_views group by to_char(created_at at time zone 'Asia/Tokyo', 'YYYY-MM')) x), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(v order by v->>'app_version' desc) from (
        select jsonb_build_object('app_version', app_version, 'users', count(distinct user_id), 'page_views', count(*)) v
        from page_views where created_at >= now() - interval '7 days' group by app_version) x), '[]'::jsonb),
    'errors_daily', coalesce((
      select jsonb_agg(e order by e->>'day') from (
        select jsonb_build_object('day', (created_at at time zone 'Asia/Tokyo')::date, 'errors', count(*), 'users', count(distinct user_id)) e
        from client_errors where created_at >= v_since group by (created_at at time zone 'Asia/Tokyo')::date) x), '[]'::jsonb),
    'errors_top', coalesce((
      select jsonb_agg(t) from (
        select jsonb_build_object('fingerprint', fingerprint, 'message', min(message), 'count', count(*),
                                  'paths', string_agg(distinct path, ', '), 'last_seen', max(created_at)) t
        from client_errors where created_at >= v_since group by fingerprint order by count(*) desc limit 10) x), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(i order by i->>'site') from (
        select jsonb_build_object('site', site, 'total', count(*), 'success', count(*) filter (where outcome = 'success'),
                                  'fetch_failed', count(*) filter (where outcome = 'fetch_failed'),
                                  'no_recipe_data', count(*) filter (where outcome = 'no_recipe_data')) i
        from recipe_import_runs where created_at >= v_since group by site) x), '[]'::jsonb),
    'imports_since', (select min(created_at) from recipe_import_runs),
    'contacts', coalesce((
      select jsonb_agg(c order by c->>'created_at' desc) from (
        select jsonb_build_object('id', id, 'created_at', created_at, 'category', category, 'body', body,
                                  'reply_email', reply_email, 'email_purged', email_purged_at is not null,
                                  'status', status, 'admin_note', admin_note, 'app_version', app_version) c
        from contact_messages order by created_at desc limit 100) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function admin_dashboard(int) from public, anon;
grant execute on function admin_dashboard(int) to authenticated;

-- お問い合わせの対応状況を更新する(運営者だけ。変更できるのは状態とメモだけ)
create or replace function admin_update_contact(p_id uuid, p_status text, p_note text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_gate text := admin_gate();
begin
  if v_gate <> 'ok' then
    return v_gate;
  end if;
  if p_status not in ('open', 'in_progress', 'closed') then
    raise exception '状態が正しくありません';
  end if;
  update contact_messages
  set status = p_status, admin_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
      handled_at = case when p_status = 'closed' then now() else handled_at end
  where id = p_id;
  return 'ok';
end;
$$;
revoke all on function admin_update_contact(uuid, text, text) from public, anon;
grant execute on function admin_update_contact(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 5. 返信先メールアドレスの90日削除(pg_cron が有効な場合だけ毎日。無効なら手動で purge_contact_emails())
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $sql$ select cron.unschedule(jobid) from cron.job where jobname = 'purge-contact-emails' $sql$;
    execute $sql$ select cron.schedule('purge-contact-emails', '45 3 * * *', 'select public.purge_contact_emails()') $sql$;
  else
    raise notice 'pg_cron が無効なため、返信先メールアドレスの90日削除は手動で行ってください';
  end if;
end $$;
