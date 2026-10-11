-- migration 026: 全体共通の換算の目安と計量の単位。合成データと初期データだけを使う。
reset role;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000a26');

-- 1. 初期データ: 出典つきで、共通の品目にだけ結び付いている
do $$
declare
  n int;
begin
  select count(*) into n from ingredient_catalog_unit_conversions;
  assert n = 153, format('初期データは153行(実際 %s)', n);
  assert (select count(distinct catalog_id) from ingredient_catalog_unit_conversions) = 94, '94品目に付いている';
  assert not exists (
    select 1 from ingredient_catalog_unit_conversions v join ingredient_catalog c on c.id = v.catalog_id where c.group_id is not null
  ), '家庭専用の品目には付いていない';
  assert not exists (select 1 from ingredient_catalog_unit_conversions where source_url !~ '^https://'), 'すべて出典の URL がある';
  assert not exists (select 1 from ingredient_catalog_unit_conversions where usage_policy = 'allowed_auto'), '自動で確定する目安はない';
  assert (select to_quantity from ingredient_catalog_unit_conversions v join ingredient_catalog c on c.id = v.catalog_id
          where c.name = 'ニラ' and c.group_id is null and v.from_unit = '束') = 100, 'ニラ1束 ≈ 100g';
  assert (select to_quantity from ingredient_catalog_unit_conversions v join ingredient_catalog c on c.id = v.catalog_id
          where c.name = '小松菜' and c.group_id is null and v.from_unit = '束') = 300, '小松菜1束 ≈ 300g(にらと違う)';
  assert (select min_quantity || '-' || max_quantity from ingredient_catalog_unit_conversions v join ingredient_catalog c on c.id = v.catalog_id
          where c.name = '卵' and c.group_id is null) = '58-64', '卵は幅で持つ';
  assert (select count(*) from ingredient_catalog_unit_conversions v join ingredient_catalog c on c.id = v.catalog_id
          where c.name = 'エビ' and c.group_id is null and v.from_unit = '尾') = 2, 'エビはむき身と殻つきで別の行';
  assert (select base_amount from measurement_units where unit = '大さじ') = 15 and (select base_amount from measurement_units where unit = '合') = 180, '計量の単位';
  -- 共通の目安は「単位だけ」の行を持たない(1パックは品目ごと)
  assert not exists (select 1 from ingredient_catalog_unit_conversions where catalog_id is null), '品目のない行はない';
end $$;

-- 2. 家庭専用の品目には(運用者でも)結び付けられない
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a26', false);
do $$
declare
  g groups;
begin
  g := create_group('換算テストの家');
  insert into ingredient_catalog (name, unit, category, group_id) values ('うちの干し野菜', 'g', 'その他', g.id);
end $$;
reset role;
do $$
declare
  own uuid := (select id from ingredient_catalog where name = 'うちの干し野菜' and group_id is not null);
begin
  assert own is not null;
  assert pg_temp.err(format(
    'insert into ingredient_catalog_unit_conversions (catalog_id, from_unit, to_unit, to_quantity, weight_basis, source_id, source_url) values (%L, %L, %L, 10, %L, %L, %L)',
    own, '袋', 'g', 'net', 'TEST', 'https://example.com/')) like '%共通の食材マスタ%', '家庭専用の品目には付けられない';
end $$;

-- 3. 利用者は読むだけ。追加・変更・削除はできない。未ログインは読めない
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a26', false);
do $$
declare
  nira uuid := (select id from ingredient_catalog where name = 'ニラ' and group_id is null);
begin
  assert (select count(*) from ingredient_catalog_unit_conversions) = 153, 'ログインした利用者は読める';
  assert (select count(*) from measurement_units) = 9, '計量の単位も読める';
  assert pg_temp.err(format(
    'insert into ingredient_catalog_unit_conversions (catalog_id, from_unit, to_unit, to_quantity, weight_basis, source_id, source_url) values (%L, %L, %L, 1, %L, %L, %L)',
    nira, '袋', 'g', 'net', 'USER', 'https://example.com/')) like '%permission denied%', '追加できない';
  assert pg_temp.err('update ingredient_catalog_unit_conversions set to_quantity = 1') like '%permission denied%', '変更できない';
  assert pg_temp.err('delete from ingredient_catalog_unit_conversions') like '%permission denied%', '削除できない';
  assert pg_temp.err('update measurement_units set base_amount = 1') like '%permission denied%', '計量の単位も変更できない';
end $$;

reset role;
set role anon;
do $$
begin
  assert pg_temp.err('select count(*) from ingredient_catalog_unit_conversions') like '%permission denied%', '未ログインは読めない';
end $$;
reset role;

\echo unit_conversions.test.sql: all assertions passed
