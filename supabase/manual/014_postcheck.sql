-- migration 014 の適用後に実行する(読み取りのみ)。すべて true で、件数と在庫の合計が適用前と同じなら完了。
select '代替ルールと調理記録のテーブルがあり、RLS が有効' as check_name,
       (select bool_and(relrowsecurity) from pg_class where oid in (
          'public.ingredient_substitutions'::regclass, 'public.substitution_opt_outs'::regclass,
          'public.cook_logs'::regclass, 'public.cook_log_items'::regclass, 'public.cook_log_batch_usages'::regclass)) as ok
union all
select '共通の代替ルールが50組以上',
       (select count(*) from ingredient_substitutions where group_id is null) >= 50
union all
select 'クライアントは調理記録を書き換えられない(読むだけ)',
       has_table_privilege('authenticated', 'public.cook_logs', 'SELECT')
       and not has_table_privilege('authenticated', 'public.cook_logs', 'INSERT')
       and not has_table_privilege('authenticated', 'public.cook_logs', 'UPDATE')
       and not has_table_privilege('authenticated', 'public.cook_log_batch_usages', 'SELECT')
union all
select '調理と取り消しの RPC はログイン中のユーザーだけが使える',
       has_function_privilege('authenticated', 'public.cook_recipe_v2(uuid, jsonb, uuid)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.undo_cook(uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.cook_recipe_v2(uuid, jsonb, uuid)', 'EXECUTE')
union all
select '二重送信を防ぐ一意インデックスがある',
       exists (select 1 from pg_indexes where indexname = 'cook_logs_request_idx');

select 'ingredients' as table_name, count(*), sum(quantity) from ingredients
union all select 'ingredient_batches', count(*), sum(quantity) from ingredient_batches
union all select 'recipes', count(*), null from recipes
union all select 'recipe_ingredients', count(*), null from recipe_ingredients;
