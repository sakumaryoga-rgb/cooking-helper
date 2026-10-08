-- migration 012(レシピURL取り込み)の適用前に SQL Editor で実行する(読み取りのみ)。
-- 「前提」がすべて true なら適用してよい。件数は控えておき、適用後と比べる。

select '前提: recipes と recipe_ingredients がある' as check_name,
       to_regclass('public.recipes') is not null and to_regclass('public.recipe_ingredients') is not null as ok
union all
select '前提: ingredient_batches がある(006 適用済み)',
       to_regclass('public.ingredient_batches') is not null
union all
select '初回適用なら source_key 列はまだない(再実行時は false でよい)',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipes' and column_name = 'source_key')
union all
select '参考: タイトルが200文字を超えるレシピはない(あっても適用できる。新しい制約は既存行を検査しない)',
       not exists (select 1 from recipes where char_length(title) > 200);

-- 控える件数
select 'recipes' as table_name, count(*) from recipes
union all select 'recipe_ingredients', count(*) from recipe_ingredients
union all select 'ingredients', count(*) from ingredients
union all select 'ingredient_batches', count(*) from ingredient_batches;
