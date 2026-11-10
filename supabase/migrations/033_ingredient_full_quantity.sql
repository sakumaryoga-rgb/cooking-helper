-- 033: 冷蔵庫の在庫ゲージ用に「満タンの量」を覚える
--
-- 何度実行しても同じ結果になる。既存の在庫の数量・ロットは変更しない。
-- ingredients.full_quantity: 最後に在庫を増やしたときの量(ゲージの100%)。
--   - 在庫を増やした(買った・＋)とき: 増やした後の量
--   - 減らしたとき: そのまま(ゲージが減る)。0 になったら空にする
--   - 何らかの理由で今の量より小さければ、今の量にそろえる
-- どの経路(adjust_stock・食材をまとめる・直接の更新)で数量が変わっても、トリガーでそろえる。

alter table ingredients add column if not exists full_quantity numeric;

create or replace function track_ingredient_full_quantity()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.quantity is null or new.quantity <= 0 then
    new.full_quantity := null;
  elsif tg_op = 'INSERT' or new.quantity > coalesce(old.quantity, 0) then
    new.full_quantity := new.quantity;
  elsif new.full_quantity is null or new.full_quantity < new.quantity then
    new.full_quantity := new.quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_track_ingredient_full_quantity on ingredients;
create trigger trg_track_ingredient_full_quantity
  before insert or update of quantity, full_quantity on ingredients
  for each row execute function track_ingredient_full_quantity();

-- いまある在庫は、今の量を満タンとする
update ingredients set full_quantity = quantity where full_quantity is null and quantity > 0;
