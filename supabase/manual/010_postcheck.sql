-- migration 010 の適用後に SQL Editor で実行する(読み取りのみ)。すべて true なら完了。

select '招待用のテーブルがある' as check_name,
       to_regclass('public.group_invites') is not null and to_regclass('public.invite_join_attempts') is not null as ok
union all
select 'クライアントは招待用のテーブルを読み書きできない',
       not has_table_privilege('authenticated', 'public.group_invites', 'SELECT')
       and not has_table_privilege('authenticated', 'public.group_invites', 'INSERT')
       and not has_table_privilege('authenticated', 'public.invite_join_attempts', 'SELECT')
       and not has_table_privilege('anon', 'public.group_invites', 'SELECT')
union all
select 'RLS が有効',
       (select bool_and(relrowsecurity) from pg_class where oid in ('public.group_invites'::regclass, 'public.invite_join_attempts'::regclass))
union all
select 'ログイン中のユーザーは招待の RPC を使える',
       has_function_privilege('authenticated', 'public.create_group_invite()', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.get_group_invite_status()', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.revoke_group_invite()', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.join_group_with_invite(text)', 'EXECUTE')
union all
select '未ログインは招待の RPC を使えない',
       not has_function_privilege('anon', 'public.join_group_with_invite(text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.create_group_invite()', 'EXECUTE')
union all
select 'ハッシュ関数はクライアントから使えない',
       not has_function_privilege('authenticated', 'public.invite_token_hash(text)', 'EXECUTE')
union all
select '旧方式の join_group は停止済み',
       (select prosrc like '%招待コードは使えなくなりました%' from pg_proc where proname = 'join_group' and pronamespace = 'public'::regnamespace)
union all
select '旧版アプリのため invite_code は 011 まで読める',
       has_column_privilege('authenticated', 'public.groups', 'invite_code', 'SELECT');

-- 適用前の控えと同じであること(010 はデータを変更しない)
select 'groups' as table_name, count(*) from groups
union all select 'group_members', count(*) from group_members
union all select 'groups の旧招待コードあり', count(*) from groups where invite_code is not null;
