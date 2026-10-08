-- migration 009 を適用した後に SQL Editor で実行する(読み取りのみ)。
-- 「参考」以外の行がすべて true なら適用は完了。

select 'page_views と client_errors がある' as check_name,
       to_regclass('public.page_views') is not null and to_regclass('public.client_errors') is not null as ok
union all
select 'RLS が有効',
       (select bool_and(relrowsecurity) from pg_class where oid in ('public.page_views'::regclass, 'public.client_errors'::regclass))
union all
select 'ポリシーは INSERT の2つだけ',
       (select count(*) = 2 and bool_and(cmd = 'INSERT') from pg_policies where schemaname = 'public' and tablename in ('page_views', 'client_errors'))
union all
select 'authenticated は SELECT / UPDATE / DELETE できない',
       not has_table_privilege('authenticated', 'public.page_views', 'SELECT')
       and not has_table_privilege('authenticated', 'public.page_views', 'UPDATE')
       and not has_table_privilege('authenticated', 'public.page_views', 'DELETE')
       and not has_table_privilege('authenticated', 'public.client_errors', 'SELECT')
       and not has_table_privilege('authenticated', 'public.client_errors', 'UPDATE')
       and not has_table_privilege('authenticated', 'public.client_errors', 'DELETE')
union all
select 'anon は何もできない',
       not has_table_privilege('anon', 'public.page_views', 'INSERT')
       and not has_table_privilege('anon', 'public.client_errors', 'INSERT')
       and not has_table_privilege('anon', 'public.page_views', 'SELECT')
union all
select 'authenticated は user_id と created_at を書けない',
       not has_column_privilege('authenticated', 'public.page_views', 'user_id', 'INSERT')
       and not has_column_privilege('authenticated', 'public.page_views', 'created_at', 'INSERT')
       and not has_column_privilege('authenticated', 'public.client_errors', 'user_id', 'INSERT')
       and not has_column_privilege('authenticated', 'public.client_errors', 'created_at', 'INSERT')
       and has_column_privilege('authenticated', 'public.page_views', 'path', 'INSERT')
union all
select '削除関数はクライアントから実行できない',
       not has_function_privilege('authenticated', 'public.purge_usage_and_error_logs(interval)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.purge_usage_and_error_logs(interval)', 'EXECUTE')
union all
select 'インデックスが6つある',
       (select count(*) from pg_indexes where schemaname = 'public' and tablename in ('page_views', 'client_errors') and indexname not like '%_pkey') = 6
union all
select '参考: pg_cron が有効(false なら 90 日削除は手動で行う)',
       exists (select 1 from pg_extension where extname = 'pg_cron');

-- pg_cron が有効な場合だけ、次の1行のコメントを外して実行し、1行返ることを確かめる
-- (返らない場合は supabase/manual/009_schedule_purge.sql を実行する)
-- select jobname, schedule, command from cron.job where jobname = 'purge-usage-and-error-logs';

-- 既存テーブルの件数(適用前の控えと同じであること)
select 'groups' as table_name, count(*) from groups
union all select 'group_members', count(*) from group_members
union all select 'ingredients', count(*) from ingredients
union all select 'recipes', count(*) from recipes;
