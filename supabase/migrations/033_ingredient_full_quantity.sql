-- 033: 冷蔵庫の在庫ゲージ用に「満タンの量」(ingredients.full_quantity)を覚える
--
-- 何度実行しても同じ結果になる。既存の在庫の数量・ロット・レシピ・調理の記録は変更しない
-- (変えるのは、追加する列 full_quantity の値だけ)。
--
-- 満タンの量(ゲージの100%)の決め方:
--   - 買い足し・補充(adjust_stock で増やす: ＋ボタン・量を入れて追加・レシピ保存時の「家にある」。古いアプリも同じ関数)
--       → 増やした後の在庫の総量。例: 卵4個に2個足すと6個が満タン。その後2個使うと 4/6
--   - 使った(減らした): 変えない。在庫が0になったら空(null)にする
--   - 調理の取り消し・食材をまとめるなど、買い足し以外で増えたとき: 満タンの量は下げず、在庫が超えたときだけ在庫にそろえる
--     (取り消しを買い足しとみなしてゲージを100%に戻さない)
--   - 単位が変わったとき: 今の量を満タンにする(違う単位の値を残さない)
--   - 満タンの量は、今の在庫より小さくならない(ゲージが100%を超えない)
-- 判定は ingredients のトリガーで行うので、別の端末・どの経路で数量が変わっても同じになる。
-- 列を足す前の古いアプリも adjust_stock を呼ぶので、そのまま正しく更新される。

alter table ingredients add column if not exists full_quantity numeric;

create or replace function track_ingredient_full_quantity()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.quantity is null or new.quantity <= 0 then
    new.full_quantity := null;
  elsif tg_op = 'INSERT' then
    new.full_quantity := greatest(coalesce(new.full_quantity, 0), new.quantity);
  elsif new.unit is distinct from old.unit then
    new.full_quantity := new.quantity;
  elsif new.full_quantity is distinct from old.full_quantity and new.full_quantity is not null then
    -- 明示的に入れた満タンの量(adjust_stock の買い足し)。今の在庫より小さければ在庫にそろえる
    new.full_quantity := greatest(new.full_quantity, new.quantity);
  else
    -- 買い足し以外の増減: 満タンの量は下げない(分からなければ変更前の在庫を満タンとみなす)
    new.full_quantity := greatest(coalesce(old.full_quantity, old.quantity, 0), new.quantity);
  end if;
  if new.full_quantity is not null and new.full_quantity <= 0 then
    new.full_quantity := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_track_ingredient_full_quantity on ingredients;
create trigger trg_track_ingredient_full_quantity
  before insert or update of quantity, full_quantity, unit on ingredients
  for each row execute function track_ingredient_full_quantity();

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
    -- 買い足し(増やした)ときは、増やした後の量を在庫ゲージの満タンにする(migration 033)
    update ingredients set
      quantity = v_next,
      full_quantity = case when p_delta > 0 then v_next else full_quantity end
    where id = p_ingredient_id and group_id = v_group;
  end if;

  return query select v_next, v_deleted;
end;
$$;
revoke all on function adjust_stock(uuid, numeric, boolean, date, date) from public, anon;
grant execute on function adjust_stock(uuid, numeric, boolean, date, date) to authenticated;

-- いまある在庫は、今の量を満タンとする(まだ満タンの量がない行だけ。再実行しても上書きしない)
update ingredients set full_quantity = quantity where full_quantity is null and quantity > 0;
