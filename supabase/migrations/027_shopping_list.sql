-- 027: 買い物リスト(常備品の買い足し)。
-- 「作った」のあとや冷蔵庫の常備品の棚で「なくなった」とマークした食材を、家の買い物リストに出す。
-- リストに入るのは利用者がマークした食材だけ(在庫が0になった食材を自動では入れない)。
-- 冷蔵庫の行(ingredients)に印を付けるだけなので、読み書きの権限は既存の ingredients の RLS(家ごと)に従う。
-- 何度実行しても同じ結果になる。既存のデータは変えない(新しい列は空)。
alter table ingredients add column if not exists restock_requested_at timestamptz;
create index if not exists idx_ingredients_restock on ingredients (group_id) where restock_requested_at is not null;

-- 在庫の増減(migration 015 と同じ。在庫0での自動削除だけ、買い物リストに入っている食材を除く)
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

  -- 在庫0になり、どのレシピからも使われておらず、買い物リストにも入っていなければ食材ごと消す
  if v_next = 0 and p_delta < 0
     and not exists (select 1 from recipe_ingredients where ingredient_id = p_ingredient_id)
     -- 買い物リストに入っている食材は、在庫が0になっても消さない(リストから消えないように)
     and (select restock_requested_at from ingredients where id = p_ingredient_id) is null then
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
