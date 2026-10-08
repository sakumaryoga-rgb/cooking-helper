-- migration 015 の適用後に実行する(読み取りのみ)。すべて true で、件数と合計が適用前と同じなら完了。
select 'ロットに賞味期限・消費期限の列がある(DATE)' as check_name,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ingredient_batches'
          and column_name in ('best_before', 'use_by') and data_type = 'date') = 2 as ok
union all
select '既存のロットの期限は空のまま',
       not exists (select 1 from ingredient_batches where (best_before is not null or use_by is not null) and created_at < now() - interval '1 minute')
union all
select '賞味期限と消費期限の両方は入れられない(制約あり)',
       exists (select 1 from pg_constraint where conname = 'ingredient_batches_one_expiry')
union all
select '期限つきの在庫追加はログイン中のユーザーだけが使える',
       has_function_privilege('authenticated', 'public.adjust_stock(uuid, numeric, boolean, date, date)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.adjust_stock(uuid, numeric, boolean, date, date)', 'EXECUTE')
union all
select 'ロット消費の内部関数はクライアントから呼べない',
       not has_function_privilege('authenticated', 'public.consume_ingredient_batches(uuid, numeric, uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.add_to_ingredient_batch(uuid, numeric, date, date, date)', 'EXECUTE')
union all
select '調理記録にロットの期限の列がある',
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cook_log_batch_usages'
          and column_name in ('best_before', 'use_by')) = 2
union all
select 'ロットの RLS は有効なまま',
       (select relrowsecurity from pg_class where oid = 'public.ingredient_batches'::regclass);

select 'ingredients' as table_name, count(*), sum(quantity) from ingredients
union all select 'ingredient_batches', count(*), sum(quantity) from ingredient_batches
union all select 'cook_logs', count(*), null from cook_logs;
