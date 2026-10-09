-- COOKDOOR v1.10.0: お問い合わせを Notion のデータベースに登録する(BASKETBALL STATS と同じ方式)
--
-- お問い合わせは今までどおり Supabase(contact_messages)に保存する。そのうえで Vercel Function が
-- Notion のデータベースにページを作り、そのページ ID を notion_page_id に記録する。
-- 同期の状態は既存の列をそのまま使う: notified_at = Notion に登録済み、notify_error = 失敗の理由、
-- notify_attempts = 試行回数、notify_claimed_at = 登録処理中(二重に処理しない印)。
-- 取り出し(claim_contact_notifications / claim_own_contact_notifications)と再送(admin_retry_contact_notification)も既存のものを使う。
-- 返信先のメールアドレスは Notion に送らない(Supabase だけに保存する)。
--
-- 既存のデータは変更しない(列・関数の追加と、管理画面の集計の置き換えだけ)。何度実行しても同じ結果になる。

alter table contact_messages add column if not exists notion_page_id text;
alter table contact_messages drop constraint if exists contact_messages_notion_page_id_format;
alter table contact_messages add constraint contact_messages_notion_page_id_format
  check (notion_page_id is null or notion_page_id ~ '^[0-9a-f-]{32,36}$');
create unique index if not exists contact_messages_notion_page_idx on contact_messages (notion_page_id) where notion_page_id is not null;

-- Notion への登録の結果を記録する(service_role だけ)。成功ならページ ID と登録日時、失敗なら理由
create or replace function mark_contact_notion_sync(p_id uuid, p_page_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_page_id is not null then
    update contact_messages
    set notion_page_id = p_page_id, notified_at = now(), notify_error = null, notify_claimed_at = null
    where id = p_id;
  else
    update contact_messages
    set notify_error = left(coalesce(p_error, '不明なエラー'), 200), notify_claimed_at = null
    where id = p_id;
  end if;
end;
$$;
revoke all on function mark_contact_notion_sync(uuid, text, text) from public, anon, authenticated;
grant execute on function mark_contact_notion_sync(uuid, text, text) to service_role;

-- 管理画面の集計(018 の内容に notion_page_id を加える)
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
                                  'notified_at', notified_at, 'notify_error', notify_error, 'notify_attempts', notify_attempts,
                                  'notion_page_id', notion_page_id) c
        from contact_messages order by created_at desc limit 100) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function admin_dashboard(int) from public, anon;
grant execute on function admin_dashboard(int) to authenticated;
