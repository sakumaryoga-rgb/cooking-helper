-- migration 010(招待トークン)の適用前に SQL Editor で実行する(読み取りのみ)。
-- 「前提」がすべて true なら適用してよい。件数は控えておき、適用後と比べる。

select '前提: my_group_id() がある' as check_name,
       exists (select 1 from pg_proc where proname = 'my_group_id' and pronamespace = 'public'::regnamespace) as ok
union all
select '前提: pgcrypto の digest が extensions スキーマにある',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'extensions' and p.proname = 'digest')
union all
select '前提: pgcrypto の gen_random_bytes が extensions スキーマにある',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'extensions' and p.proname = 'gen_random_bytes')
union all
select '初回適用なら group_invites はまだない(再実行時は false でよい)',
       to_regclass('public.group_invites') is null;

-- 控える件数
select 'groups' as table_name, count(*) from groups
union all select 'group_members', count(*) from group_members
union all select 'groups の旧招待コードあり', count(*) from groups where invite_code is not null;
