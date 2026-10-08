-- migration 015(ロットの期限と FEFO)のテスト。合成データのみ。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000d7'),
  ('00000000-0000-4000-8000-0000000000d8');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d8', false);
do $$ begin perform create_group('期限の別の家'); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d7', false);
do $$
declare
  g groups;
  ing uuid;
  r uuid;
  log uuid;
  res record;
begin
  g := create_group('期限の家');
  -- 食材マスタにない食材(推定期限は購入日 + 7日)
  insert into ingredients (group_id, name, unit, quantity) values (g.id, '自家製ピクルス', '個', 0) returning id into ing;
  perform set_config('test.ing', ing::text, false);

  -- A: 3日前に購入・期限の入力なし(推定 +4日)、B: 消費期限 明日、C: 賞味期限 2日後、D: 日付なし、E: 3日前に購入・賞味期限 +4日
  perform adjust_stock(ing, 10, true, null, null);
  update ingredient_batches set added_on = current_date - 3 where ingredient_id = ing and added_on = current_date;
  perform adjust_stock(ing, 10, true, null, current_date + 1);
  perform adjust_stock(ing, 10, true, current_date + 2, null);
  perform adjust_stock(ing, 10, false, null, null);
  perform adjust_stock(ing, 10, false, current_date + 4, null);
  assert (select quantity from ingredients where id = ing) = 50, '合計50';
  assert (select count(*) from ingredient_batches where ingredient_id = ing) = 5, 'ロットは5つ';

  -- 同じ購入日・同じ期限なら1つのロットにまとまる
  perform adjust_stock(ing, 5, true, current_date + 2, null);
  assert (select quantity from ingredient_batches where ingredient_id = ing and best_before = current_date + 2) = 15, '同じ期限のロットにまとまる';
  perform adjust_stock(ing, -5, true, null, null);

  -- 賞味期限と消費期限の両方は入れられない
  begin
    perform adjust_stock(ing, 1, true, current_date + 1, current_date + 1);
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm like '賞味期限と消費期限は%', sqlerrm;
  end;
  begin
    insert into ingredient_batches (ingredient_id, quantity, best_before, use_by) values (ing, 1, current_date, current_date);
    raise exception 'should have failed';
  exception when check_violation then null;
  end;

  -- 減らす: 消費期限 明日(B)→ 賞味期限 2日後(C)→ 同じ +4日 なら購入日の古い A(推定)→ E(日付なし・賞味期限)→ 日付なし D
  perform adjust_stock(ing, -12, true, null, null);
  assert not exists (select 1 from ingredient_batches where ingredient_id = ing and use_by is not null), '消費期限の近いBが最初に消える';
  assert (select quantity from ingredient_batches where ingredient_id = ing and best_before = current_date + 2) = 8, '次に賞味期限の近いCから2';
  perform adjust_stock(ing, -8, true, null, null);
  perform adjust_stock(ing, -4, true, null, null);
  assert (select quantity from ingredient_batches where ingredient_id = ing and added_on = current_date - 3) = 6, '同じ期限(+4日)では購入日の古いA(推定)から';
  assert (select quantity from ingredient_batches where ingredient_id = ing and best_before = current_date + 4) = 10, 'E(購入日なし)は後';
  assert (select quantity from ingredient_batches where ingredient_id = ing and added_on is null and best_before is null) = 10, '期限のないDは最後まで残る';

  -- 作った → 取り消し: ロットの期限ごと戻る
  insert into recipes (group_id, title) values (g.id, 'ピクルスの和え物') returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, ing, 20);
  log := cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', ing, 'quantity', 20)), gen_random_uuid());
  assert (select quantity from ingredients where id = ing) = 6, '26 - 20 = 6';
  assert undo_cook(log), '取り消せる';
  assert (select quantity from ingredients where id = ing) = 26, '数量が戻る';
  assert (select quantity from ingredient_batches where ingredient_id = ing and added_on = current_date - 3 and best_before is null) = 6, 'Aが戻る';
  assert (select quantity from ingredient_batches where ingredient_id = ing and best_before = current_date + 4) = 10, 'Eが賞味期限ごと戻る';
  assert (select quantity from ingredient_batches where ingredient_id = ing and added_on is null and best_before is null) = 10, 'Dが戻る';
  assert (select sum(quantity) from ingredient_batches where ingredient_id = ing) = 26, 'ロットの合計と数量が一致';

  -- 内部用の関数はクライアントから呼べない
  begin
    perform consume_ingredient_batches(ing, 1, null);
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 別の家庭は在庫も期限も変えられず、ロットも見えない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d8', false);
do $$
declare n int;
begin
  assert (select count(*) from ingredient_batches where ingredient_id = current_setting('test.ing')::uuid) = 0, '他の家庭のロットは見えない';
  begin
    perform adjust_stock(current_setting('test.ing')::uuid, 1, true, current_date, null);
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '権限がありません', sqlerrm;
  end;
  update ingredient_batches set use_by = current_date where ingredient_id = current_setting('test.ing')::uuid;
  get diagnostics n = row_count;
  assert n = 0, '他の家庭のロットの期限は変えられない';
end $$;

reset role;
set role anon;
do $$
begin
  perform adjust_stock(gen_random_uuid(), 1, true, null, null);
  raise exception 'should have failed';
exception when insufficient_privilege then null;
end $$;

reset role;
\echo 'expiry.test.sql: all assertions passed'
