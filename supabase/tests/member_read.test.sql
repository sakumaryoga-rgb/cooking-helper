-- migration 029(食材マスタ・別名・代替ルール・調理の記録の読み取りを所属している家に広げる)のテスト。合成データのみ
-- M: 2つの家(M家・N家)に所属。S: N家だけに所属。O: どちらにも所属していない(他人の O家)
reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000ff301'),  -- M
  ('00000000-0000-4000-8000-0000000ff302'),  -- S
  ('00000000-0000-4000-8000-0000000ff303');  -- O

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

-- O: 他人の家に、家庭専用の品目・別名・代替ルール・調理の記録を作る
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff303', false);
do $$
declare
  g groups;
  c uuid;
  i uuid;
  r uuid;
begin
  g := create_group('O家');
  perform set_config('test.o', g.id::text, false);
  insert into ingredient_catalog (name, unit, category, sort_order, group_id) values ('O家の香辛料', 'g', 'その他', 9000, g.id) returning id into c;
  insert into ingredient_aliases (alias, catalog_id, group_id) values ('O家の呼び名', c, g.id);
  insert into ingredients (group_id, name, unit, quantity, catalog_id) values (g.id, 'O家の香辛料', 'g', 10, c) returning id into i;
  insert into recipes (group_id, title) values (g.id, 'O家の料理') returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, i, 1);
  perform cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', i, 'quantity', 1, 'kind', 'required')), gen_random_uuid());
end $$;

-- M: M家を作り、S が作った N家に招待で参加する(先に作った M家が「最初の家」)
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff301', false);
do $$
declare g groups;
begin
  g := create_group('M家');
  perform set_config('test.m', g.id::text, false);
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff302', false);
do $$
declare g groups;
begin
  g := create_group('N家');
  perform set_config('test.n', g.id::text, false);
  perform set_config('test.n_token', (select invite_token from create_group_invite()), false);
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff301', false);
do $$ begin perform join_group_with_invite(current_setting('test.n_token')); end $$;

-- 各家に家庭専用の品目・別名・代替ルール・調理の記録を作る(それぞれの家を選んで書き込む)
do $$
declare
  hs text[] := array[current_setting('test.m'), current_setting('test.n')];
  h text;
  c uuid;
  c2 uuid;
  i uuid;
  r uuid;
begin
  foreach h in array hs loop
    perform set_config('request.headers', json_build_object('x-cookdoor-group', h)::text, false);
    insert into ingredient_catalog (name, unit, category, sort_order, group_id) values ('品目' || h, 'g', 'その他', 9000, h::uuid) returning id into c;
    insert into ingredient_catalog (name, unit, category, sort_order, group_id) values ('代替' || h, 'g', 'その他', 9001, h::uuid) returning id into c2;
    insert into ingredient_aliases (alias, catalog_id, group_id) values ('別名' || h, c, h::uuid);
    insert into ingredient_substitutions (from_catalog_id, to_catalog_id, ratio, group_id) values (c, c2, 1, h::uuid);
    insert into ingredients (group_id, name, unit, quantity, catalog_id) values (h::uuid, '品目' || h, 'g', 10, c) returning id into i;
    insert into recipes (group_id, title) values (h::uuid, '料理' || h) returning id into r;
    insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, i, 1);
    perform cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', i, 'quantity', 1, 'kind', 'required')), gen_random_uuid());
  end loop;
end $$;

-- 1. 2つの家に所属する M: どちらの家を選んでいても、ヘッダーがなくても(リアルタイムの通知と同じ)、所属している家の行は読める。他人の家は読めない
do $$
declare
  m uuid := current_setting('test.m')::uuid;
  n uuid := current_setting('test.n')::uuid;
  o uuid := current_setting('test.o')::uuid;
  hdr text;
begin
  foreach hdr in array array[json_build_object('x-cookdoor-group', m)::text, json_build_object('x-cookdoor-group', n)::text, ''] loop
    perform set_config('request.headers', hdr, false);
    assert (select count(distinct group_id) from ingredient_catalog where group_id is not null) = 2, '食材マスタ: M家と N家の品目が読める';
    assert exists (select 1 from ingredient_catalog where group_id is null), '共通の品目も読める';
    assert not exists (select 1 from ingredient_catalog where group_id = o), '他人の家の品目は読めない';
    assert (select count(distinct group_id) from ingredient_aliases where group_id is not null) = 2, '別名: 所属している2つの家';
    assert not exists (select 1 from ingredient_aliases where group_id = o);
    assert (select count(distinct group_id) from ingredient_substitutions where group_id is not null) = 2, '代替ルール: 所属している2つの家';
    assert (select count(distinct group_id) from cook_logs) = 2, '調理の記録: 所属している2つの家';
    assert not exists (select 1 from cook_logs where group_id = o);
    assert (select count(*) from cook_log_items) = 2, '調理の記録の行: 所属している家の記録だけ';
  end loop;
end $$;

-- 2. 読み取りが広がっても、書き込みは選んでいる家(M家)だけ
select set_config('request.headers', json_build_object('x-cookdoor-group', current_setting('test.m'))::text, false);
do $$
declare
  n uuid := current_setting('test.n')::uuid;
  nc uuid;
  n_rows int;
begin
  select id into nc from ingredient_catalog where group_id = n and name like '品目%';
  update ingredient_catalog set name = '書き換え' where id = nc;
  get diagnostics n_rows = row_count;
  assert n_rows = 0, '選んでいない家(N家)の品目は変更できない';
  delete from ingredient_catalog where id = nc;
  get diagnostics n_rows = row_count;
  assert n_rows = 0, '選んでいない家の品目は削除できない';
  assert (select name from ingredient_catalog where id = nc) like '品目%';
  assert pg_temp.err(format('insert into ingredient_catalog (name, unit, category, sort_order, group_id) values (%L, %L, %L, 1, %L)', 'x', 'g', 'その他', n)) is not null,
    '選んでいない家に品目を追加できない';
  assert pg_temp.err(format('insert into ingredient_aliases (alias, catalog_id, group_id) values (%L, %L, %L)', 'y', nc, n)) is not null,
    '選んでいない家に別名を追加できない';
  delete from ingredient_aliases where group_id = n;
  get diagnostics n_rows = row_count;
  assert n_rows = 0, '選んでいない家の別名は削除できない';
  delete from ingredient_substitutions where group_id = n;
  get diagnostics n_rows = row_count;
  assert n_rows = 0, '選んでいない家の代替ルールは削除できない';
  assert pg_temp.err(format('update cook_logs set recipe_title = %L where group_id = %L', 'x', n)) is not null, '調理の記録は直接変更できない(権限なし)';
end $$;

-- 3. N家だけに所属する S: 共通 + N家だけ(M家・O家は読めない)
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff302', false);
select set_config('request.headers', '', false);
do $$
declare n uuid := current_setting('test.n')::uuid;
begin
  assert (select array_agg(distinct group_id) from ingredient_catalog where group_id is not null) = array[n], 'S は N家の品目だけ';
  assert (select array_agg(distinct group_id) from ingredient_aliases where group_id is not null) = array[n];
  assert (select array_agg(distinct group_id) from ingredient_substitutions where group_id is not null) = array[n];
  assert (select array_agg(distinct group_id) from cook_logs) = array[n];
  assert (select count(*) from cook_log_items) = 1;
end $$;

-- 4. 他人(O)からは M家・N家の行は読めない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff303', false);
do $$
begin
  assert (select array_agg(distinct group_id) from ingredient_catalog where group_id is not null) = array[current_setting('test.o')::uuid];
  assert (select count(*) from cook_logs) = 1;
  assert (select count(*) from ingredient_aliases where group_id is not null) = 1;
end $$;

\echo 'member_read.test.sql: all assertions passed'
