-- migration 015(ロットの期限と FEFO)の適用前に実行する(読み取りのみ)。
-- 「前提」がすべて true なら適用してよい。件数と合計を控えておき、適用後と比べる。
select '前提: 014 適用済み(cook_recipe_v2 がある)' as check_name,
       exists (select 1 from pg_proc where proname = 'cook_recipe_v2' and pronamespace = 'public'::regnamespace) as ok
union all
select '初回適用なら best_before 列はまだない(再実行時は false でよい)',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ingredient_batches' and column_name = 'best_before');

select 'ingredients' as table_name, count(*), sum(quantity) from ingredients
union all select 'ingredient_batches', count(*), sum(quantity) from ingredient_batches
union all select 'cook_logs', count(*), null from cook_logs;
