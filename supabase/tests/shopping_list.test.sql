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
