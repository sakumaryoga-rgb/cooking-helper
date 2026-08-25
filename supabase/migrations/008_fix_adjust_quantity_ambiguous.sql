-- adjust_ingredient_quantity の RETURNS TABLE(quantity ...) が
-- "quantity"というOUTパラメータ名を作ってしまい、関数内のあらゆる
-- `update ... set quantity = ...` がテーブル列かOUT変数か曖昧になって
-- 42702 (column reference "quantity" is ambiguous) で毎回失敗していた。
-- OUT列名をnew_quantityに変更して衝突を解消する。
drop function if exists adjust_ingredient_quantity(uuid, numeric, boolean);

create or replace function adjust_ingredient_quantity(
  p_ingredient_id uuid,
  p_delta numeric,
  p_dated_today boolean default true
)
returns table(new_quantity numeric, deleted boolean)
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
        update ingredient_batches set quantity = ingredient_batches.quantity + p_delta where id = existing_batch_id;
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

-- 調査用に作成した一時関数を削除
drop function if exists debug_group_check(uuid);
