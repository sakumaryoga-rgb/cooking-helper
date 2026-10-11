-- migration 027: 買い物リストの印。合成データのみ。家ごとに分かれ、ほかの家からは付けられない
reset role;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000b27'), ('00000000-0000-4000-8000-000000000c27');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c27', false);
do $$ begin perform create_group('別の家'); end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b27', false);
do $$
declare
  g groups;
  salt uuid;
begin
  g := create_group('買い物の家');
  insert into ingredients (group_id, name, unit, quantity, is_staple) values (g.id, '塩', 'g', 0, true) returning id into salt;
  perform set_config('test.salt', salt::text, false);
  update ingredients set restock_requested_at = now() where id = salt;
  assert (select restock_requested_at is not null from ingredients where id = salt), '家のメンバーは買い物リストに入れられる';
  assert (select quantity from ingredients where id = salt) = 0 and (select is_staple from ingredients where id = salt), '数量と常備品の設定は変わらない';
  update ingredients set restock_requested_at = null where id = salt;
  assert (select restock_requested_at is null from ingredients where id = salt), '買ったら外せる';
  update ingredients set restock_requested_at = now() where id = salt;
end $$;

-- 在庫0の整理(adjust_stock の自動削除)で、買い物リストに入っている食材は消えない。取り消しはリストを変えない
do $$
declare
  g uuid := my_group_id();
  soy uuid;
  plain uuid;
  rec uuid;
  log uuid;
  r record;
begin
  -- 常備品から外した(数える食材にした)が、買い物リストに入っている食材
  insert into ingredients (group_id, name, unit, quantity, is_staple) values (g, 'しょうゆ', 'ml', 0, false) returning id into soy;
  perform adjust_stock(soy, 2, false, null, null);
  update ingredients set restock_requested_at = now() where id = soy;
  select * into r from adjust_stock(soy, -2, false, null, null);
  assert r.new_quantity = 0 and not r.deleted, '買い物リストの食材は在庫0でも消さない';
  assert exists (select 1 from ingredients where id = soy and restock_requested_at is not null), 'リストの印も残る';

  -- 買い物リストに入っていない食材は、従来どおり在庫0で消える
  insert into ingredients (group_id, name, unit, quantity) values (g, 'もやし', '袋', 0) returning id into plain;
  perform adjust_stock(plain, 1, false, null, null);
  select * into r from adjust_stock(plain, -1, false, null, null);
  assert r.deleted, '買い物リストに入っていない食材は従来どおり消える';

  -- 作った → 取り消すで、在庫と記録が戻る。2回目の取り消しは何もしない。買い物リストの印は変えない
  perform adjust_stock(soy, 30, false, null, null);
  insert into recipes (group_id, title, created_by) values (g, '照り焼き', auth.uid()) returning id into rec;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (rec, soy, 20);
  log := cook_recipe_v2(rec, jsonb_build_array(jsonb_build_object('ingredient_id', soy, 'quantity', 20)), '33333333-3333-4333-8333-000000000027');
  assert (select quantity from ingredients where id = soy) = 10, '作ると引かれる';
  assert undo_cook(log), '取り消せる';
  assert (select quantity from ingredients where id = soy) = 30, '取り消すと戻る';
  assert not undo_cook(log), '2回目の取り消しは何もしない';
  assert (select quantity from ingredients where id = soy) = 30, '二重には戻さない';
  assert (select undone_at is not null from cook_logs where id = log), '記録は取り消し済み';
  assert exists (select 1 from ingredients where id = soy and restock_requested_at is not null), '取り消しても買い物リストは変えない';
end $$;

-- ほかの家のメンバーは、見えないし印も付けられない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c27', false);
do $$
declare
  n int;
begin
  assert not exists (select 1 from ingredients where id = current_setting('test.salt')::uuid), 'ほかの家の食材は見えない';
  update ingredients set restock_requested_at = null where id = current_setting('test.salt')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'ほかの家の買い物リストは変えられない';
end $$;
reset role;
do $$
begin
  assert (select restock_requested_at is not null from ingredients where id = current_setting('test.salt')::uuid), '元の家の印は残っている';
end $$;

\echo shopping_list.test.sql: all assertions passed
