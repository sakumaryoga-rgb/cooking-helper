-- COOKDOOR v1.6.0(Phase 5): 在庫ロットの賞味期限・消費期限と、期限の近い順(FEFO)の消費
--
-- 1. ingredient_batches に best_before(賞味期限)と use_by(消費期限)を追加する。どちらも任意で、
--    1つのロットに入れられるのはどちらか一方だけ。既存のロットは両方 null のまま(数量も変えない)。
-- 2. ロットの消費順を FEFO に統一する: 消費期限 → 賞味期限 → 推定期限(購入日 + 食材マスタの日持ち日数、
--    マスタにない場合は7日)のうち、使える期限の早い順。同じ期限なら購入日の古い順。期限がないロット
--    (購入日も期限もない)は最後。consume_ingredient_batches() に1本化し、数量の減算・作った(新旧)で使う。
-- 3. 期限つきで在庫を増やす adjust_stock() を追加する。旧 adjust_ingredient_quantity は adjust_stock を呼ぶ。
-- 4. 調理の記録にロットの期限も残し、取り消しで期限ごと元のロットに戻す。
--
-- 既存のロック(食材の行の for update)と、在庫より多く差し引かない動作はそのまま。
-- 何度実行しても同じ結果になる。SQL Editor で全体をそのまま実行する。

-- ------------------------------------------------------------
-- 1. 列と制約
-- ------------------------------------------------------------
alter table ingredient_batches add column if not exists best_before date;
alter table ingredient_batches add column if not exists use_by date;
alter table ingredient_batches drop constraint if exists ingredient_batches_one_expiry;
alter table ingredient_batches add constraint ingredient_batches_one_expiry
  check (best_before is null or use_by is null);
alter table ingredient_batches drop constraint if exists ingredient_batches_expiry_range;
alter table ingredient_batches add constraint ingredient_batches_expiry_range
  check ((best_before is null or best_before between date '2000-01-01' and date '2100-12-31')
     and (use_by is null or use_by between date '2000-01-01' and date '2100-12-31'));
create index if not exists ingredient_batches_ingredient_idx on ingredient_batches (ingredient_id);

alter table cook_log_batch_usages add column if not exists best_before date;
alter table cook_log_batch_usages add column if not exists use_by date;

-- ------------------------------------------------------------
-- 2. FEFO でロットを消費する(内部用。クライアントからは直接呼べない)
-- ------------------------------------------------------------
-- 呼び出し側が ingredients の行をロックしてから呼ぶ。p_cook_log_id があれば、どのロットから使ったかを記録する
create or replace function consume_ingredient_batches(p_ingredient_id uuid, p_quantity numeric, p_cook_log_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_remaining numeric := p_quantity;
  v_take numeric;
  b record;
begin
  if v_remaining is null or v_remaining <= 0 then
    return;
  end if;
  for b in
    select bt.id, bt.quantity, bt.added_on, bt.best_before, bt.use_by
    from ingredient_batches bt
    join ingredients i on i.id = bt.ingredient_id
    left join ingredient_catalog c on c.id = i.catalog_id
    where bt.ingredient_id = p_ingredient_id and bt.quantity > 0
    order by coalesce(bt.use_by, bt.best_before, bt.added_on + coalesce(c.shelf_life_days, 7)) nulls last,
             bt.added_on nulls last,
             bt.created_at
    for update of bt
  loop
    exit when v_remaining <= 0;
    v_take := least(b.quantity, v_remaining);
    if p_cook_log_id is not null then
      insert into cook_log_batch_usages (cook_log_id, ingredient_id, added_on, best_before, use_by, quantity)
      values (p_cook_log_id, p_ingredient_id, b.added_on, b.best_before, b.use_by, v_take);
    end if;
    if v_take >= b.quantity then
      delete from ingredient_batches where id = b.id;
    else
      update ingredient_batches set quantity = b.quantity - v_take where id = b.id;
    end if;
    v_remaining := v_remaining - v_take;
  end loop;
end;
$$;
revoke all on function consume_ingredient_batches(uuid, numeric, uuid) from public, anon, authenticated;

-- 同じ購入日・同じ期限のロットにまとめて足す(なければ作る)。内部用
create or replace function add_to_ingredient_batch(p_ingredient_id uuid, p_quantity numeric, p_added_on date, p_best_before date, p_use_by date)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_batch uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    return;
  end if;
  select id into v_batch from ingredient_batches
  where ingredient_id = p_ingredient_id
    and added_on is not distinct from p_added_on
    and best_before is not distinct from p_best_before
    and use_by is not distinct from p_use_by
  order by created_at limit 1
  for update;
  if v_batch is null then
    insert into ingredient_batches (ingredient_id, quantity, added_on, best_before, use_by)
    values (p_ingredient_id, p_quantity, p_added_on, p_best_before, p_use_by);
  else
    update ingredient_batches set quantity = quantity + p_quantity where id = v_batch;
  end if;
end;
$$;
revoke all on function add_to_ingredient_batch(uuid, numeric, date, date, date) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. 在庫の増減(期限つき)
-- ------------------------------------------------------------
create or replace function adjust_stock(
  p_ingredient_id uuid,
  p_delta numeric,
  p_dated_today boolean,
  p_best_before date,
  p_use_by date
)
returns table(new_quantity numeric, deleted boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
  v_ing_group uuid;
  v_current numeric;
  v_next numeric;
  v_deleted boolean := false;
begin
  select i.group_id, i.quantity into v_ing_group, v_current
  from ingredients i where i.id = p_ingredient_id for update;
  if v_group is null or v_ing_group is null or v_ing_group <> v_group then
    raise exception '権限がありません';
  end if;
  if p_best_before is not null and p_use_by is not null then
    raise exception '賞味期限と消費期限は、どちらか一方だけを入力してください';
  end if;
  if p_delta is null or abs(p_delta) > 1000000 then
    raise exception '数量が正しくありません';
  end if;

  v_next := greatest(v_current + p_delta, 0);

  if p_delta > 0 then
    perform add_to_ingredient_batch(p_ingredient_id, p_delta,
      case when p_dated_today then current_date else null end, p_best_before, p_use_by);
  elsif p_delta < 0 then
    perform consume_ingredient_batches(p_ingredient_id, v_current - v_next, null);
  end if;

  -- 在庫0になり、どのレシピからも使われていなければ食材ごと消す(従来どおり)
  if v_next = 0 and p_delta < 0
     and not exists (select 1 from recipe_ingredients where ingredient_id = p_ingredient_id) then
    delete from ingredients where id = p_ingredient_id and group_id = v_group;
    v_deleted := true;
  end if;
  if not v_deleted then
    update ingredients set quantity = v_next where id = p_ingredient_id and group_id = v_group;
  end if;

  return query select v_next, v_deleted;
end;
$$;
revoke all on function adjust_stock(uuid, numeric, boolean, date, date) from public, anon;
grant execute on function adjust_stock(uuid, numeric, boolean, date, date) to authenticated;

-- 旧版のアプリのための入口(期限なし)
create or replace function adjust_ingredient_quantity(
  p_ingredient_id uuid,
  p_delta numeric,
  p_dated_today boolean default true
)
returns table(new_quantity numeric, deleted boolean)
language sql
security definer
set search_path = public, extensions
as $$
  select * from adjust_stock(p_ingredient_id, p_delta, p_dated_today, null, null);
$$;
grant execute on function adjust_ingredient_quantity(uuid, numeric, boolean) to authenticated;

-- ------------------------------------------------------------
-- 4. 作った(新): ロットの消費を FEFO の共通関数に置き換える
-- ------------------------------------------------------------
create or replace function cook_recipe_v2(p_recipe_id uuid, p_items jsonb, p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
  v_user uuid := auth.uid();
  v_title text;
  v_log uuid;
  v_item record;
  v_ing ingredients;
  v_use numeric;
begin
  if v_user is null or v_group is null then
    raise exception '権限がありません';
  end if;
  select title into v_title from recipes where id = p_recipe_id and group_id = v_group;
  if v_title is null then
    raise exception '権限がありません';
  end if;
  if p_request_id is null then
    raise exception 'request_id が必要です';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 100 then
    raise exception '材料の指定が正しくありません';
  end if;

  insert into cook_logs (group_id, recipe_id, recipe_title, request_id, cooked_by)
  values (v_group, p_recipe_id, v_title, p_request_id, v_user)
  on conflict (group_id, request_id) do nothing
  returning id into v_log;
  if v_log is null then
    select id into v_log from cook_logs where group_id = v_group and request_id = p_request_id;
    return v_log;
  end if;

  for v_item in
    select (e ->> 'ingredient_id')::uuid as ingredient_id,
           sum(greatest(coalesce((e ->> 'quantity')::numeric, 0), 0)) as quantity,
           max(nullif(left(e ->> 'substitute_for', 40), '')) as substitute_for
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    select * into v_ing from ingredients where id = v_item.ingredient_id and group_id = v_group for update;
    if not found then
      raise exception '権限がありません';
    end if;
    if v_item.quantity > 1000000 then
      raise exception '数量が大きすぎます';
    end if;
    v_use := least(v_item.quantity, greatest(v_ing.quantity, 0));
    insert into cook_log_items (cook_log_id, ingredient_id, ingredient_name, unit, requested_quantity, used_quantity, substitute_for)
    values (v_log, v_ing.id, v_ing.name, v_ing.unit, v_item.quantity, v_use, v_item.substitute_for);
    if v_use > 0 then
      update ingredients set quantity = quantity - v_use where id = v_ing.id;
      perform consume_ingredient_batches(v_ing.id, v_use, v_log);
    end if;
  end loop;

  return v_log;
end;
$$;

-- ------------------------------------------------------------
-- 5. 取り消し: 量と、ロットの購入日・期限を戻す
-- ------------------------------------------------------------
create or replace function undo_cook(p_cook_log_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
  v_log cook_logs;
  it record;
  u record;
begin
  if auth.uid() is null or v_group is null then
    raise exception '権限がありません';
  end if;
  select * into v_log from cook_logs where id = p_cook_log_id and group_id = v_group for update;
  if not found then
    raise exception '権限がありません';
  end if;
  if v_log.undone_at is not null then
    return false;
  end if;

  for it in
    select ingredient_id, sum(used_quantity) as used
    from cook_log_items where cook_log_id = v_log.id and ingredient_id is not null
    group by ingredient_id order by ingredient_id
  loop
    perform 1 from ingredients where id = it.ingredient_id and group_id = v_group for update;
    if found and it.used > 0 then
      update ingredients set quantity = quantity + it.used where id = it.ingredient_id;
      for u in
        select added_on, best_before, use_by, quantity
        from cook_log_batch_usages where cook_log_id = v_log.id and ingredient_id = it.ingredient_id
      loop
        perform add_to_ingredient_batch(it.ingredient_id, u.quantity, u.added_on, u.best_before, u.use_by);
      end loop;
    end if;
  end loop;

  update cook_logs set undone_at = now(), undone_by = auth.uid() where id = v_log.id;
  return true;
end;
$$;

-- ------------------------------------------------------------
-- 6. 作った(旧版のアプリ用): ロットの消費を同じ FEFO に揃える
-- ------------------------------------------------------------
create or replace function cook_recipe(p_recipe_id uuid, p_used jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r recipe_ingredients%rowtype;
  v_group uuid := my_group_id();
  v_recipe_group uuid;
  v_current numeric;
  v_use numeric;
begin
  select group_id into v_recipe_group from recipes where id = p_recipe_id;
  if v_recipe_group is null or v_recipe_group <> v_group then
    raise exception '権限がありません';
  end if;

  for r in select * from recipe_ingredients where recipe_id = p_recipe_id order by ingredient_id loop
    select quantity into v_current from ingredients where id = r.ingredient_id and group_id = v_group for update;
    if not found then
      continue;
    end if;
    v_use := least(greatest(coalesce((p_used ->> r.ingredient_id::text)::numeric, r.required_quantity), 0), v_current);
    if v_use > 0 then
      perform consume_ingredient_batches(r.ingredient_id, v_use, null);
      update ingredients set quantity = quantity - v_use where id = r.ingredient_id;
    end if;
  end loop;
end;
$$;
