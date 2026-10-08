-- migration 012 が本番に適用済みかを確かめる(読み取りのみ)。5行すべて true なら適用済み。
select 'recipes に source_key / source_site / servings がある' as check_name,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'recipes'
          and column_name in ('source_key', 'source_site', 'servings')) = 3 as ok
union all
select 'recipe_ingredients に raw_text がある',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipe_ingredients' and column_name = 'raw_text')
union all
select '重複検出の一意インデックスがある',
       exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'recipes_group_source_key_idx')
union all
select 'remove_ingredient があり、ログイン中のユーザーだけが使える',
       has_function_privilege('authenticated', 'public.remove_ingredient(uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.remove_ingredient(uuid)', 'EXECUTE')
union all
select '制約が4つある',
       (select count(*) from pg_constraint where conname in ('recipes_source_key_format', 'recipes_servings_range',
          'recipes_source_site_length', 'recipe_ingredients_raw_text_length')) = 4;
