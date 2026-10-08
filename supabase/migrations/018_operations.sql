-- COOKDOOR v1.9.0: 一般公開に向けた運用の仕上げ
--
-- 1. 運営者の無効化(app_admins.disabled_at)。無効にした運営者は管理用 RPC を使えない(権限の判断は DB 側)。
-- 2. お問い合わせの通知: 通知の状態(未通知・送信中・失敗の理由・試行回数)を記録する列と、
--    サーバー(Vercel Function、service_role)だけが使う「未通知を取り出す」「結果を記録する」関数。
--    同じお問い合わせを同時に2回送らないよう、取り出すときに行をロックして印を付ける。
-- 3. 管理画面の集計に、お問い合わせの件数(状態別・通知)と、保存期間(90日)を過ぎた記録の件数、
--    自動削除(pg_cron)の登録状況を加える。
--
-- 既存のデータは変更しない(列の追加だけ)。何度実行しても同じ結果になる。SQL Editor で全体をそのまま実行する。
-- migration 011 と、保留中の supabase/pending/017_drop_legacy.sql とは独立している。

-- ------------------------------------------------------------
-- 1. 運営者の無効化
-- ------------------------------------------------------------
alter table app_admins add column if not exists disabled_at timestamptz;

create or replace function is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from app_admins where user_id = auth.uid() and disabled_at is null);
$$;

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
  if exists (select 1 from app_admins where user_id = v_user and disabled_at is null) then
    return 'ok';
  end if;
  insert into admin_access_attempts (user_id) values (v_user);
  delete from admin_access_attempts where created_at < now() - interval '1 day';
  return 'forbidden';
end;
$$;
revoke all on function admin_gate() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. お問い合わせの通知
-- ------------------------------------------------------------
alter table contact_messages add column if not exists notify_attempts int not null default 0;
alter table contact_messages add column if not exists notify_claimed_at timestamptz;
alter table contact_messages add column if not exists notify_error text;
create index if not exists contact_messages_unnotified_idx on contact_messages (created_at) where notified_at is null;

-- 未通知のお問い合わせを取り出して「送信中」の印を付ける。送信中の印が10分より新しいものは取り出さない
-- (同時に呼ばれても同じものを2回送らない)。5回失敗したものは自動では取り出さない(管理画面で確認する)。
-- 返信先メールアドレスは返さない(通知先の外部サービスに個人情報を送らないため)。
create or replace function claim_contact_notifications(p_limit int default 10)
returns table (contact_id uuid, contact_created_at timestamptz, contact_category text, contact_body text, contact_app_version text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  with picked as (
    select m.id from contact_messages m
    where m.notified_at is null
      and m.notify_attempts < 5
      and (m.notify_claimed_at is null or m.notify_claimed_at < now() - interval '10 minutes')
    order by m.created_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update skip locked
  )
  update contact_messages m
  set notify_claimed_at = now(), notify_attempts = m.notify_attempts + 1
  from picked
  where m.id = picked.id
  returning m.id, m.created_at, m.category, left(m.body, 500), m.app_version;
end;
$$;

-- 送信の結果を記録する。成功なら notified_at、失敗なら理由(200文字まで)。送信中の印は外す
create or replace function mark_contact_notification(p_id uuid, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update contact_messages
  set notified_at = case when p_ok then now() else notified_at end,
      notify_error = case when p_ok then null else left(coalesce(p_error, '不明なエラー'), 200) end,
      notify_claimed_at = null
  where id = p_id;
end;
$$;

-- 管理画面の「再通知」: 失敗したお問い合わせの試行回数を戻して、次の通知で再び送る(運営者だけ)
create or replace function admin_retry_contact_notification(p_id uuid)
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
  update contact_messages set notify_attempts = 0, notify_claimed_at = null where id = p_id and notified_at is null;
  return 'ok';
end;
$$;

revoke all on function claim_contact_notifications(int) from public, anon, authenticated;
revoke all on function mark_contact_notification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function claim_contact_notifications(int) to service_role;
grant execute on function mark_contact_notification(uuid, boolean, text) to service_role;
revoke all on function admin_retry_contact_notification(uuid) from public, anon;
grant execute on function admin_retry_contact_notification(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. 管理画面の集計(016 の内容に、お問い合わせの件数・通知・保存期間を加える)
-- ------------------------------------------------------------
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
  v_cron jsonb := '[]'::jsonb;
begin
  if v_gate <> 'ok' then
    return jsonb_build_object('error', v_gate);
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $sql$ select coalesce(jsonb_agg(jobname), '[]'::jsonb) from cron.job
                  where jobname in ('purge-usage-and-error-logs', 'purge-contact-emails') $sql$ into v_cron;
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
    'emails_overdue', (select count(*) from contact_messages where reply_email is not null and created_at < now() - interval '90 days'),
    'contact_counts', jsonb_build_object(
      'open', (select count(*) from contact_messages where status = 'open'),
      'in_progress', (select count(*) from contact_messages where status = 'in_progress'),
      'closed', (select count(*) from contact_messages where status = 'closed'),
      'unnotified', (select count(*) from contact_messages where notified_at is null),
      'notify_failed', (select count(*) from contact_messages where notified_at is null and notify_error is not null)),
    'retention', jsonb_build_object(
      'page_views_overdue', (select count(*) from page_views where created_at < now() - interval '90 days'),
      'client_errors_overdue', (select count(*) from client_errors where created_at < now() - interval '90 days'),
      'emails_overdue', (select count(*) from contact_messages where reply_email is not null and created_at < now() - interval '90 days'),
      'cron_jobs', v_cron),
    'contacts', coalesce((
      select jsonb_agg(c order by c->>'created_at' desc) from (
        select jsonb_build_object('id', id, 'created_at', created_at, 'category', category, 'body', body,
                                  'reply_email', reply_email, 'email_purged', email_purged_at is not null,
                                  'status', status, 'admin_note', admin_note, 'app_version', app_version,
                                  'notified_at', notified_at, 'notify_error', notify_error, 'notify_attempts', notify_attempts) c
        from contact_messages order by created_at desc limit 100) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function admin_dashboard(int) from public, anon;
grant execute on function admin_dashboard(int) to authenticated;
