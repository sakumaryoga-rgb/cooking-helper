-- migration 032(レシピの評価・食材をまとめる)のテスト。合成データのみ
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000ff601'),  -- E: E家
  ('00000000-0000-4000-8000-0000000ff602');  -- F: F家(他人)

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

set role authenticated;
select set_config('request.headers', '', false);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff602', false);
do $$
declare g groups; x uuid;
begin
  g := create_group('F家');
  insert into ingredients (group_id, name, unit, quantity) values (g.id, 'F家の豚バラ', 'g', 100) returning id into x;
  perform set_config('test.other', x::text, false);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff601', false);
do $$
declare
  g groups;
  keep uuid;
  drp uuid;
  kcat uuid;
  dcat uuid;
  r1 uuid;
  r2 uuid;
  log1 uuid;
begin
  g := create_group('E家');
  perform set_config('test.g', g.id::text, false);
  insert into ingredient_catalog (name, unit, category, sort_order, group_id) values ('豚バラ', 'g', '肉', 9000, g.id) returning id into kcat;
  insert into ingredient_catalog (name, unit, category, sort_order, group_id) values ('豚バラ肉', 'g', '肉', 9001, g.id) returning id into dcat;
  insert into ingredient_aliases (alias, catalog_id, group_id) values ('豚ばら', dcat, g.id);
  insert into ingredients (group_id, name, unit, quantity, catalog_id) values (g.id, '豚バラ', 'g', 0, kcat) returning id into keep;
  perform adjust_ingredient_quantity(keep, 200, true);
  insert into ingredients (group_id, name, unit, quantity, catalog_id) values (g.id, '豚バラ肉', 'g', 0, dcat) returning id into drp;
  perform adjust_ingredient_quantity(drp, 150, true);
  update ingredients set restock_requested_at = now() where id = drp;
  insert into ingredient_unit_conversions (ingredient_id, unit, amount) values (drp, 'パック', 250);

  -- r1: 両方の食材を使う。r2: まとめる側だけ(手順でも使う)
  insert into recipes (group_id, title) values (g.id, '豚の角煮') returning id into r1;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, amount_text) values (r1, keep, 200, null), (r1, drp, 100, null);
  insert into recipes (group_id, title, steps) values (g.id, '回鍋肉', jsonb_build_array(jsonb_build_object('text', '炒める', 'uses', jsonb_build_array(jsonb_build_object('ingredient_id', drp, 'quantity', 150))))) returning id into r2;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r2, drp, 150);
  log1 := cook_recipe_v2(r2, jsonb_build_array(jsonb_build_object('ingredient_id', drp, 'quantity', 50, 'kind', 'required')), gen_random_uuid());

  perform merge_ingredients(keep, drp);

  assert not exists (select 1 from ingredients where id = drp), 'まとめた側の行は消える';
  assert (select quantity from ingredients where id = keep) = 300, '在庫を足す(200 + 150 - 調理50)';
  assert (select coalesce(sum(quantity), 0) from ingredient_batches where ingredient_id = keep) = 300, 'ロットも移す';
  assert (select restock_requested_at is not null from ingredients where id = keep), '買い物リストの印を引き継ぐ';
  assert (select amount from ingredient_unit_conversions where ingredient_id = keep and unit = 'パック') = 250, '家庭の換算を移す';
  assert (select count(*) from recipe_ingredients where recipe_id = r1) = 1, '同じレシピの2行は1行にまとめる';
  assert (select required_quantity from recipe_ingredients where recipe_id = r1) = 300, '分量を足す';
  assert (select ingredient_id from recipe_ingredients where recipe_id = r2) = keep, 'レシピの材料を移す';
  assert (select steps -> 0 -> 'uses' -> 0 ->> 'ingredient_id' from recipes where id = r2) = keep::text, '手順で使う材料も移す';
  assert (select ingredient_id from cook_log_items where cook_log_id = log1) = keep, '調理の記録を移す';
  assert (select catalog_id from ingredient_aliases where group_id = g.id and alias = '豚バラ肉') = kcat, 'まとめた名前を別名として覚える';
  assert (select catalog_id from ingredient_aliases where group_id = g.id and alias = '豚ばら') = kcat, 'まとめた側の別名を付け替える';
  assert not exists (select 1 from ingredient_catalog where id = dcat), '使わなくなった家庭専用の品目は消す';
  perform set_config('test.keep', keep::text, false);
end $$;

-- 単位が違う食材: まとめる側の在庫があればまとめられない。在庫0ならまとめ、レシピの数の分量は表記として残す
do $$
declare
  g uuid := current_setting('test.g')::uuid;
  egg uuid;
  egg2 uuid;
  r uuid;
begin
  insert into ingredients (group_id, name, unit, quantity) values (g, '卵', '個', 6) returning id into egg;
  insert into ingredients (group_id, name, unit, quantity) values (g, 'たまご', 'パック', 1) returning id into egg2;
  assert pg_temp.err(format('select merge_ingredients(%L, %L)', egg, egg2)) like '単位が違う食材%', '在庫がある単位違いはまとめない';
  update ingredients set quantity = 0 where id = egg2;
  insert into recipes (group_id, title) values (g, '卵焼き') returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, egg2, 1);
  perform merge_ingredients(egg, egg2);
  assert (select required_quantity is null and amount_text = '1パック' from recipe_ingredients where recipe_id = r), '単位違いの分量は表記として残す';
  assert (select quantity from ingredients where id = egg) = 6;
end $$;

-- 他人の家の食材・同じ食材・選んでいない家はまとめられない
do $$
begin
  assert pg_temp.err(format('select merge_ingredients(%L, %L)', current_setting('test.keep'), current_setting('test.other'))) = '権限がありません', '他人の家の食材';
  assert pg_temp.err(format('select merge_ingredients(%L, %L)', current_setting('test.keep'), current_setting('test.keep'))) is not null, '同じ食材';
end $$;

-- 評価: 0.5刻みの 0.5〜5 だけ。家族が付けた評価を家で共有する
do $$
declare r uuid;
begin
  select id into r from recipes where title = '豚の角煮';
  update recipes set rating = 4.5 where id = r;
  assert (select rating from recipes where id = r) = 4.5;
  assert pg_temp.err(format('update recipes set rating = 4.3 where id = %L', r)) is not null, '0.5刻み以外は入れられない';
  assert pg_temp.err(format('update recipes set rating = 0 where id = %L', r)) is not null, '0 は入れられない(未評価は null)';
  assert pg_temp.err(format('update recipes set rating = 5.5 where id = %L', r)) is not null;
  update recipes set rating = null where id = r;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff602', false);
do $$
declare n int;
begin
  update recipes set rating = 1 where title = '豚の角煮';
  get diagnostics n = row_count;
  assert n = 0, '他人の家のレシピは評価できない';
end $$;

\echo 'rating_merge.test.sql: all assertions passed'
