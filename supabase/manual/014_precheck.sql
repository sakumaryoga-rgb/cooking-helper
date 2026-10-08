-- migration 014(代替ルール・調理の記録)の適用前に実行する(読み取りのみ)。
-- 「前提」がすべて true なら適用してよい。件数を控えておき、適用後と比べる。
select '前提: 013 適用済み(食材マスタに group_id がある)' as check_name,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ingredient_catalog' and column_name = 'group_id') as ok
union all
select '前提: 旧 cook_recipe がある(旧版のアプリのため残す)',
       exists (select 1 from pg_proc where proname = 'cook_recipe' and pronamespace = 'public'::regnamespace)
union all
select '初回適用なら cook_logs はまだない(再実行時は false でよい)',
       to_regclass('public.cook_logs') is null;

select 'ingredients' as table_name, count(*), sum(quantity) from ingredients
union all select 'ingredient_batches', count(*), sum(quantity) from ingredient_batches
union all select 'recipes', count(*), null from recipes
union all select 'recipe_ingredients', count(*), null from recipe_ingredients;
