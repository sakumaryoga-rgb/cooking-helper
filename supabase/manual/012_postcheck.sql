-- migration 012 の適用後に SQL Editor で実行する(読み取りのみ)。すべて true なら完了。

select '新しい列が4つある' as check_name,
       (select count(*) from information_schema.columns where table_schema = 'public'
          and ((table_name = 'recipes' and column_name in ('source_key', 'source_site', 'servings'))
            or (table_name = 'recipe_ingredients' and column_name = 'raw_text'))) = 4 as ok
union all
select '重複検出の一意インデックスがある',
       exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'recipes_group_source_key_idx')
union all
select 'recipes と recipe_ingredients の RLS は有効なまま',
       (select bool_and(relrowsecurity) from pg_class where oid in ('public.recipes'::regclass, 'public.recipe_ingredients'::regclass))
union all
select 'remove_ingredient はログイン中のユーザーだけが使える',
       has_function_privilege('authenticated', 'public.remove_ingredient(uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.remove_ingredient(uuid)', 'EXECUTE')
union all
select '既存レシピは手動登録扱い(source_key は null)',
       not exists (select 1 from recipes where source_key is not null and created_at < now() - interval '1 minute');

-- 適用前の控えと同じであること(012 はデータを変更しない)
select 'recipes' as table_name, count(*) from recipes
union all select 'recipe_ingredients', count(*) from recipe_ingredients
union all select 'ingredients', count(*) from ingredients
union all select 'ingredient_batches', count(*) from ingredient_batches;
