-- migration 013(食材マスタの権限・別名辞書・常備品)の適用前に実行する(読み取りのみ)。
-- 「前提」がすべて true なら適用してよい。件数を控えておき、適用後と比べる。

select '前提: 012 適用済み(remove_ingredient がある)' as check_name,
       exists (select 1 from pg_proc where proname = 'remove_ingredient' and pronamespace = 'public'::regnamespace) as ok
union all
select '前提: 食材マスタの名前に重複がない(共通の一意インデックスを作れる)',
       not exists (select name from ingredient_catalog group by name having count(*) > 1)
union all
select '初回適用なら group_id 列はまだない(再実行時は false でよい)',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ingredient_catalog' and column_name = 'group_id');

select 'ingredient_catalog' as table_name, count(*) from ingredient_catalog
union all select 'ingredients', count(*) from ingredients
union all select 'recipe_ingredients', count(*) from recipe_ingredients;
