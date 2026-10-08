-- migration 009 を適用する前に SQL Editor で実行する(読み取りのみ)。
-- 「前提」の行がすべて true なら適用してよい。「初回適用なら」は再実行時に false になる。「参考」は true / false どちらでもよい。

select '前提: my_group_id() がある' as check_name,
       exists (select 1 from pg_proc where proname = 'my_group_id' and pronamespace = 'public'::regnamespace) as ok
union all
select '前提: groups テーブルがある',
       to_regclass('public.groups') is not null
union all
select '前提: gen_random_uuid() が使える',
       exists (select 1 from pg_proc where proname = 'gen_random_uuid')
union all
select '初回適用なら page_views はまだない(再実行時は false でよい)',
       to_regclass('public.page_views') is null
union all
select '初回適用なら client_errors はまだない(再実行時は false でよい)',
       to_regclass('public.client_errors') is null
union all
select '参考: pg_cron が有効(false なら適用後に 009_schedule_purge.sql、または手動削除)',
       exists (select 1 from pg_extension where extname = 'pg_cron');

-- 既存テーブルの件数(適用後に変わっていないことを確かめるために控えておく)
select 'groups' as table_name, count(*) from groups
union all select 'group_members', count(*) from group_members
union all select 'ingredients', count(*) from ingredients
union all select 'recipes', count(*) from recipes;
