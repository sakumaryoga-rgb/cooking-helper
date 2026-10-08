-- migration 013 の適用後に実行する(読み取りのみ)。すべて true で、件数が適用前と同じなら完了。

select '食材マスタのポリシーは4つ(読む・家庭の追加・変更・削除)' as check_name,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ingredient_catalog') = 4 as ok
union all
select '共通の品目を誰でも削除できるポリシーは消えた',
       not exists (select 1 from pg_policies where tablename = 'ingredient_catalog' and policyname like 'authenticated users can%')
union all
select '既存の品目はすべて共通のまま',
       not exists (select 1 from ingredient_catalog where group_id is not null and created_at < now() - interval '1 minute')
union all
select '別名辞書のテーブルがあり、RLS が有効',
       (select relrowsecurity from pg_class where oid = 'public.ingredient_aliases'::regclass)
union all
select '共通の別名が登録された(100件以上)',
       (select count(*) from ingredient_aliases where group_id is null) >= 100
union all
select '未ログインは食材マスタと別名を読めない',
       not has_table_privilege('anon', 'public.ingredient_catalog', 'SELECT')
       and not has_table_privilege('anon', 'public.ingredient_aliases', 'SELECT')
union all
select '常備品の列がある',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ingredients' and column_name = 'is_staple');

select 'ingredient_catalog' as table_name, count(*) from ingredient_catalog
union all select 'ingredients', count(*) from ingredients
union all select 'recipe_ingredients', count(*) from recipe_ingredients;
