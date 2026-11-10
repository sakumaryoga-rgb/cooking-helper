-- 032: レシピの評価(⭐️0.5〜5、0.5刻み)と、表記揺れの食材を1つにまとめる機能
--
-- 何度実行しても同じ結果になる。既存のレシピ・在庫・記録は削除・変更しない(merge_ingredients を呼んだときだけ変わる)。
-- 1. recipes.rating(null = 未評価。0.5〜5 の 0.5 刻み)。家で1つの評価(選んでいる家のレシピだけ変えられる。RLS は既存のまま)
-- 2. merge_ingredients(p_keep, p_drop): 同じ家の2つの食材(冷蔵庫の行)を p_keep にまとめる
--    - 在庫の数量・ロット(期限)・常備品・買い物リストの印・家庭の分量の換算を移す
--      単位が違うときは、まとめる側(p_drop)の在庫が0のときだけまとめられる(数量を足せないため)
--    - レシピの材料・手順で使う材料を移す。同じレシピに両方あれば1行にまとめる(分量を足す。どちらかが分からなければ分からない)
--    - 調理の記録の食材を移す(記録の名前・単位はそのまま)
--    - p_drop の名前を、この家の別名として p_keep の品目に覚える(次の取り込みから自動で p_keep になる)。
--      p_drop の家庭専用の品目は、ほかで使っていなければ消し、その別名は p_keep の品目に付け替える
--    - 選んでいる家の食材だけ。調理の記録は利用者が直接変更できない(migration 029)ため security definer で動き、
--      すべての変更を選んでいる家(my_group_id)の行に限る

alter table recipes add column if not exists rating numeric(2, 1);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_rating_half_steps') then
    alter table recipes add constraint recipes_rating_half_steps
      check (rating is null or (rating between 0.5 and 5 and rating * 2 = trunc(rating * 2)));
  end if;
end $$;

create or replace function merge_ingredients(p_keep uuid, p_drop uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
  v_keep ingredients;
  v_drop ingredients;
  v_keep_catalog uuid;
  r record;
begin
  if auth.uid() is null or v_group is null then
    raise exception '権限がありません';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'まとめる2つの食材を選んでください';
  end if;
  -- 同時に同じ食材をまとめないよう、決まった順に行をロックする
  perform 1 from ingredients where id in (p_keep, p_drop) and group_id = v_group order by id for update;
  select * into v_keep from ingredients where id = p_keep and group_id = v_group;
  select * into v_drop from ingredients where id = p_drop and group_id = v_group;
  if v_keep.id is null or v_drop.id is null then
    raise exception '権限がありません';
  end if;
  if v_keep.unit <> v_drop.unit and v_drop.quantity > 0 then
    raise exception '単位が違う食材(%と%)は、まとめる側の在庫を0にしてからまとめてください', v_keep.unit, v_drop.unit;
  end if;

  -- 家庭の別名・品目に使う、残す側の品目(なければ食材マスタに家庭専用の品目を作らない: 別名は覚えない)
  v_keep_catalog := v_keep.catalog_id;

  -- レシピの材料: 同じレシピに両方あれば、残す側の行にまとめてから消す
  for r in
    select k.id as keep_row, d.id as drop_row
    from recipe_ingredients d
    join recipe_ingredients k on k.recipe_id = d.recipe_id and k.ingredient_id = p_keep
    join recipes rc on rc.id = d.recipe_id and rc.group_id = v_group
    where d.ingredient_id = p_drop
  loop
    update recipe_ingredients k set
      required_quantity = case when k.required_quantity is not null and d.required_quantity is not null and v_keep.unit = v_drop.unit
                               then round(k.required_quantity + d.required_quantity, 2) end,
      amount_text = left(nullif(concat_ws(' + ', nullif(k.amount_text, ''), nullif(d.amount_text, '')), ''), 60),
      raw_text = left(nullif(concat_ws(' / ', nullif(k.raw_text, ''), nullif(d.raw_text, '')), ''), 200),
      optional = k.optional and d.optional,
      choice_group = case when k.choice_group is not null and d.choice_group is not null then least(k.choice_group, d.choice_group) end
    from recipe_ingredients d
    where k.id = r.keep_row and d.id = r.drop_row;
    delete from recipe_ingredients where id = r.drop_row;
  end loop;
  -- 単位が違うときは、移す材料の数の分量は使えない(元の表記は残す)
  update recipe_ingredients set
    ingredient_id = p_keep,
    required_quantity = case when v_keep.unit = v_drop.unit then required_quantity end,
    amount_text = case when v_keep.unit = v_drop.unit or required_quantity is null then amount_text
                       else left(coalesce(nullif(amount_text, ''), trim_scale(required_quantity)::text || v_drop.unit), 60) end
  where ingredient_id = p_drop and recipe_id in (select id from recipes where group_id = v_group);
  -- 手順で使う材料(recipes.steps の uses[].ingredient_id)
  update recipes set steps = replace(steps::text, p_drop::text, p_keep::text)::jsonb
  where group_id = v_group and steps is not null and steps::text like '%' || p_drop::text || '%';

  -- 在庫のロット(期限)と、調理の記録
  update ingredient_batches set ingredient_id = p_keep where ingredient_id = p_drop;
  update cook_log_items set ingredient_id = p_keep
  where ingredient_id = p_drop and cook_log_id in (select id from cook_logs where group_id = v_group);
  update cook_log_batch_usages set ingredient_id = p_keep
  where ingredient_id = p_drop and cook_log_id in (select id from cook_logs where group_id = v_group);

  -- 家庭の分量の換算(残す側にない単位だけ移す。単位が違う食材の換算は使えないので移さない)
  if v_keep.unit = v_drop.unit then
    insert into ingredient_unit_conversions (ingredient_id, unit, amount, updated_at)
    select p_keep, unit, amount, updated_at from ingredient_unit_conversions c
    where c.ingredient_id = p_drop
    on conflict (ingredient_id, unit) do nothing;
  end if;
  delete from ingredient_unit_conversions where ingredient_id = p_drop;

  -- 在庫・常備品・買い物リストの印
  update ingredients set
    quantity = quantity + case when v_keep.unit = v_drop.unit then v_drop.quantity else 0 end,
    is_staple = v_keep.is_staple or v_drop.is_staple,
    restock_requested_at = coalesce(least(v_keep.restock_requested_at, v_drop.restock_requested_at), v_keep.restock_requested_at, v_drop.restock_requested_at)
  where id = p_keep;
  delete from ingredients where id = p_drop;

  if v_keep_catalog is not null then
    -- まとめた側の家庭専用の品目の別名を付け替え、ほかで使っていなければ品目を消す
    if v_drop.catalog_id is not null and v_drop.catalog_id <> v_keep_catalog
       and exists (select 1 from ingredient_catalog c where c.id = v_drop.catalog_id and c.group_id = v_group) then
      update ingredient_aliases a set catalog_id = v_keep_catalog
      where a.catalog_id = v_drop.catalog_id and a.group_id = v_group
        and not exists (select 1 from ingredient_aliases x where x.group_id = v_group and x.alias = a.alias and x.catalog_id = v_keep_catalog);
      delete from ingredient_aliases where catalog_id = v_drop.catalog_id and group_id = v_group;
      if not exists (select 1 from ingredients i where i.catalog_id = v_drop.catalog_id) then
        delete from ingredient_catalog where id = v_drop.catalog_id and group_id = v_group;
      end if;
    end if;
    -- まとめた食材の名前を、この家の別名として覚える(同じ名前の別名があれば付け替える)
    if char_length(v_drop.name) between 1 and 40 then
      insert into ingredient_aliases (alias, catalog_id, group_id)
      values (v_drop.name, v_keep_catalog, v_group)
      on conflict (group_id, alias) where group_id is not null do update set catalog_id = excluded.catalog_id;
    end if;
  end if;

  return p_keep;
end;
$$;
revoke all on function merge_ingredients(uuid, uuid) from public, anon;
grant execute on function merge_ingredients(uuid, uuid) to authenticated;
