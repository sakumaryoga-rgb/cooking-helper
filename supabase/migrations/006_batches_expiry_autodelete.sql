-- お料理ヘルパーアプリ: 在庫ロット管理・賞味期限目安・在庫ゼロ時の自動削除
-- Supabaseダッシュボード > SQL Editor に、このファイルの内容をそのまま貼り付けて実行してください。

-- ============================================================
-- 1. 食材ロット(数量+追加日をまとめて記録する)
--    「追加日を購入日にする」がオンの追加は added_on = 追加日、
--    オフの追加は added_on = null(賞味期限の目安計算からは除外)
-- ============================================================

create table if not exists ingredient_batches (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  quantity numeric not null default 0 check (quantity >= 0),
  added_on date,
  created_at timestamptz not null default now()
);

create index if not exists idx_ingredient_batches_ingredient_id on ingredient_batches(ingredient_id);

alter table ingredient_batches enable row level security;

create policy "manage own group ingredient batches" on ingredient_batches
  for all
  using (
    exists (
      select 1 from ingredients i
      where i.id = ingredient_batches.ingredient_id and i.group_id = my_group_id()
    )
  )
  with check (
    exists (
      select 1 from ingredients i
      where i.id = ingredient_batches.ingredient_id and i.group_id = my_group_id()
    )
  );

alter publication supabase_realtime add table ingredient_batches;

-- ============================================================
-- 2. 食材マスタに「日持ちの目安(日数)」を追加し、カテゴリ別の目安値を投入
--    (品目ごとの厳密な値ではなく、一般的な目安)
-- ============================================================

alter table ingredient_catalog add column if not exists shelf_life_days int;

update ingredient_catalog set shelf_life_days = case category
  when '肉類' then 3
  when '魚介類' then 2
  when '果菜類' then 7
  when '葉茎菜類' then 5
  when '根菜類' then 14
  when 'キノコ類' then 7
  when '果物' then 7
  when '卵・乳製品' then 10
  when '大豆製品' then 5
  when '穀物' then 180
  when '麺・パン' then 14
  when '調味料・油' then 365
  else 7
end
where shelf_life_days is null;

-- ============================================================
-- 3. 食材マスタ(ingredient_catalog)を長押しで完全削除できるようにする
-- ============================================================

create policy "authenticated users can delete from ingredient catalog" on ingredient_catalog
  for delete
  to authenticated
  using (true);

-- ============================================================
-- 4. cook_recipe: ロットも古い方から消費(FIFO)する
--    (このRPCが扱う食材は必ず今回のレシピ自身から参照されているため、
--     在庫0時の自動削除の対象にはなり得ない。自動削除はFridge画面での
--     手動の在庫減算時のみ行う)
-- ============================================================

create or replace function cook_recipe(p_recipe_id uuid, p_used jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r recipe_ingredients%rowtype;
  used_qty numeric;
  remaining numeric;
  caller_group uuid;
  recipe_group uuid;
  b record;
begin
  caller_group := my_group_id();

  select group_id into recipe_group from recipes where id = p_recipe_id;

  if recipe_group is null or recipe_group <> caller_group then
    raise exception '権限がありません';
  end if;

  for r in select * from recipe_ingredients where recipe_id = p_recipe_id loop
    used_qty := coalesce((p_used ->> r.ingredient_id::text)::numeric, r.required_quantity);
    remaining := used_qty;

    for b in
      select * from ingredient_batches
      where ingredient_id = r.ingredient_id and quantity > 0
      order by (added_on is null), added_on, created_at
    loop
      exit when remaining <= 0;
      if b.quantity <= remaining then
        remaining := remaining - b.quantity;
        delete from ingredient_batches where id = b.id;
      else
        update ingredient_batches set quantity = b.quantity - remaining where id = b.id;
        remaining := 0;
      end if;
    end loop;

    update ingredients
      set quantity = greatest(quantity - used_qty, 0)
      where id = r.ingredient_id and group_id = caller_group;
  end loop;
end;
$$;
