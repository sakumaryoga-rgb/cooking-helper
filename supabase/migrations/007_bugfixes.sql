-- お料理ヘルパーアプリ: バグ修正まとめ
-- Supabaseダッシュボード > SQL Editor に、このファイルの内容をそのまま貼り付けて実行してください。

-- ============================================================
-- 1. ingredient_catalog をリアルタイム配信対象に追加
--    (これまでは初回取得のみで、追加・カテゴリ変更・削除が他タブ/他メンバーに
--     反映されず、長押し削除しても一覧に残り続けて見えるバグがあった)
-- ============================================================

alter publication supabase_realtime add table ingredient_catalog;

-- ============================================================
-- 2. 在庫の増減・自動削除をアトミックに行うRPCを追加
--    (クライアント側で「在庫を読む→ロットを読む→ロットを書く→在庫を書く」と
--     複数回に分けて処理していたため、素早い連打や複数端末からの同時操作で
--     更新が失われる競合状態(lost update)があった。1トランザクションにまとめる)
-- ============================================================

create or replace function adjust_ingredient_quantity(
  p_ingredient_id uuid,
  p_delta numeric,
  p_dated_today boolean default true
)
returns table(quantity numeric, deleted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_group uuid;
  ing_group uuid;
  current_qty numeric;
  next_qty numeric;
  remaining numeric;
  b record;
  still_referenced boolean;
  did_delete boolean := false;
  existing_batch_id uuid;
begin
  caller_group := my_group_id();

  select group_id, i.quantity into ing_group, current_qty
    from ingredients i
    where i.id = p_ingredient_id
    for update;

  if ing_group is null or ing_group <> caller_group then
    raise exception '権限がありません';
  end if;

  next_qty := greatest(current_qty + p_delta, 0);

  if p_delta > 0 then
    if p_dated_today then
      insert into ingredient_batches (ingredient_id, quantity, added_on)
      values (p_ingredient_id, p_delta, current_date);
    else
      select id into existing_batch_id
        from ingredient_batches
        where ingredient_id = p_ingredient_id and added_on is null
        order by created_at
        limit 1
        for update;

      if existing_batch_id is null then
        insert into ingredient_batches (ingredient_id, quantity, added_on)
        values (p_ingredient_id, p_delta, null);
      else
        update ingredient_batches set quantity = quantity + p_delta where id = existing_batch_id;
      end if;
    end if;
  elsif p_delta < 0 then
    remaining := current_qty - next_qty;

    for b in
      select * from ingredient_batches
      where ingredient_id = p_ingredient_id and quantity > 0
      order by (added_on is null) desc, added_on, created_at
      for update
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
  end if;

  if next_qty = 0 and p_delta < 0 then
    select exists (
      select 1 from recipe_ingredients where ingredient_id = p_ingredient_id
    ) into still_referenced;

    if not still_referenced then
      delete from ingredients where id = p_ingredient_id and group_id = caller_group;
      did_delete := true;
    end if;
  end if;

  if not did_delete then
    update ingredients set quantity = next_qty where id = p_ingredient_id and group_id = caller_group;
  end if;

  return query select next_qty, did_delete;
end;
$$;

grant execute on function adjust_ingredient_quantity(uuid, numeric, boolean) to authenticated;

-- ============================================================
-- 3. cook_recipe: ロット消費順のバグを修正
--    (「日付未定のロットは年代不明なので先に消費する」という設計意図に反して、
--     日付ありロットを先に消費する式になっていた。手動の在庫減算(上のRPC)と
--     順序を一致させる)
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
      order by (added_on is null) desc, added_on, created_at
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
