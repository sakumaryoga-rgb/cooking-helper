-- migration 013(食材マスタの所有、別名辞書、常備品)の権限テスト。合成データのみ。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000000c2');
select id as common_id from ingredient_catalog where name = 'にんじん' and group_id is null \gset
select set_config('test.common_id', :'common_id', false);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c2', false);
do $$ begin perform create_group('K2家'); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', false);
do $$
declare
  g groups;
  own uuid;
  n int;
begin
  g := create_group('K1家');
  perform set_config('test.k1_group', g.id::text, false);

  -- 共通の品目は読めるが、変更・削除・共通としての追加はできない
  assert exists (select 1 from ingredient_catalog where id = current_setting('test.common_id')::uuid), '共通の品目は読める';
  update ingredient_catalog set name = '改ざん', category = '改ざん' where id = current_setting('test.common_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, '共通の品目は変更できない';
  delete from ingredient_catalog where id = current_setting('test.common_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, '共通の品目は削除できない';
  begin
    insert into ingredient_catalog (name, unit, category) values ('共通に追加', '個', 'その他');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;

  -- 家庭専用の品目は追加・変更・削除できる。共通と同じ名前でも追加できる
  insert into ingredient_catalog (name, unit, category, group_id) values ('うちの特製だれ', 'ml', '調味料', g.id) returning id into own;
  insert into ingredient_catalog (name, unit, category, group_id) values ('にんじん', '本', '野菜', g.id);
  update ingredient_catalog set category = 'たれ' where id = own;
  get diagnostics n = row_count;
  assert n = 1, '家庭専用の品目は変更できる';
  begin
    update ingredient_catalog set group_id = null where id = own;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into ingredient_catalog (name, unit, category, group_id) values ('うちの特製だれ', 'ml', '調味料', g.id);
    raise exception 'should have failed';
  exception when unique_violation then null;
  end;
  perform set_config('test.k1_own', own::text, false);

  -- 別名: 共通の別名が読め、家庭の別名を共通・自分の品目に付けられる
  assert exists (select 1 from ingredient_aliases a join ingredient_catalog c on c.id = a.catalog_id
                 where a.alias = '人参' and c.name = 'にんじん' and a.group_id is null), '共通の別名「人参」がある';
  insert into ingredient_aliases (catalog_id, alias, group_id) values (own, '特製だれ', g.id);
  insert into ingredient_aliases (catalog_id, alias, group_id) values (current_setting('test.common_id')::uuid, 'キャロット', g.id);
  begin
    insert into ingredient_aliases (catalog_id, alias) values (current_setting('test.common_id')::uuid, '共通の別名');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  delete from ingredient_aliases where alias = '人参';
  get diagnostics n = row_count;
  assert n = 0, '共通の別名は削除できない';

  -- 常備品の印は自分の食材にだけ付けられる
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '塩', 'g', 0);
  update ingredients set is_staple = true where name = '塩';
  assert (select is_staple from ingredients where name = '塩'), '常備品にできる';
end $$;

-- 別の家庭(K2)からは K1 の品目・別名が見えず、操作もできない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c2', false);
do $$
declare n int;
begin
  assert not exists (select 1 from ingredient_catalog where name = 'うちの特製だれ'), 'K1 の品目は見えない';
  assert (select count(*) from ingredient_catalog where name = 'にんじん') = 1, '共通のにんじんだけが見える';
  assert not exists (select 1 from ingredient_aliases where alias in ('特製だれ', 'キャロット')), 'K1 の別名は見えない';

  update ingredient_catalog set name = 'x' where id = current_setting('test.k1_own')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'K1 の品目は変更できない';
  delete from ingredient_catalog where id = current_setting('test.k1_own')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'K1 の品目は削除できない';
  begin
    insert into ingredient_catalog (name, unit, category, group_id) values ('侵入', '個', 'その他', current_setting('test.k1_group')::uuid);
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into ingredient_aliases (catalog_id, alias, group_id) values (current_setting('test.k1_own')::uuid, '侵入', my_group_id());
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  update ingredients set is_staple = true where name = '塩';
  get diagnostics n = row_count;
  assert n = 0, 'K1 の食材を常備品にできない';
end $$;

-- 未ログインは読めない
reset role;
set role anon;
do $$
begin
  begin
    perform count(*) from ingredient_catalog;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from ingredient_aliases;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 家庭が削除されたら、その家庭の品目と別名も消える
reset role;
do $$
begin
  delete from group_members where group_id = current_setting('test.k1_group')::uuid;
  delete from ingredients where group_id = current_setting('test.k1_group')::uuid;
  delete from groups where id = current_setting('test.k1_group')::uuid;
  assert not exists (select 1 from ingredient_catalog where name = 'うちの特製だれ'), '家庭専用の品目は消える';
  assert not exists (select 1 from ingredient_aliases where alias = 'キャロット'), '家庭の別名は消える';
  assert exists (select 1 from ingredient_catalog where name = 'にんじん' and group_id is null), '共通の品目は残る';
end $$;

\echo 'catalog.test.sql: all assertions passed'
