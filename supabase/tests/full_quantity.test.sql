-- migration 033: 在庫ゲージの満タンの量。合成データのみ
reset role;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000a33');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a33', false);
do $$
declare
  g groups;
  egg uuid;
  r record;
begin
  g := create_group('ゲージの家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '卵', '個', 0) returning id into egg;
  assert (select full_quantity from ingredients where id = egg) is null, '在庫0は満タンの量なし';
  perform adjust_stock(egg, 10, true, null, null);
  assert (select full_quantity from ingredients where id = egg) = 10, '増やすと増やした後の量が満タン';
  perform adjust_stock(egg, -3, false, null, null);
  assert (select quantity from ingredients where id = egg) = 7 and (select full_quantity from ingredients where id = egg) = 10, '減らしても満タンの量は変わらない';
  perform adjust_stock(egg, 2, true, null, null);
  assert (select full_quantity from ingredients where id = egg) = 9, '買い足すと、その量が満タン';
  update ingredients set full_quantity = 1 where id = egg;
  assert (select full_quantity from ingredients where id = egg) = 9, '今の量より小さくはできない';
  -- 全部使うと食材ごと消える(レシピで使っていない食材)
  select * into r from adjust_stock(egg, -9, false, null, null);
  assert r.deleted and not exists (select 1 from ingredients where id = egg), '全部使うと冷蔵庫から消える';
end $$;
\echo full_quantity.test.sql: all assertions passed
