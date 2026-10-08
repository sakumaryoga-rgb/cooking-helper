-- migration 014(代替ルール、調理の記録、取り消し)のテスト。合成データのみ。

reset role;
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000e7'),
  ('00000000-0000-4000-8000-0000000000e8');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e8', false);
do $$ begin perform create_group('別の家'); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e7', false);
do $$
declare
  g groups;
  thigh uuid;
  breast uuid;
  r uuid;
  log1 uuid;
  log2 uuid;
  n int;
begin
  g := create_group('調理の家');
  insert into ingredients (group_id, name, unit, quantity, catalog_id)
  values (g.id, '鶏もも肉', 'g', 0, (select id from ingredient_catalog where name = '鶏もも肉' and group_id is null)) returning id into thigh;
  insert into ingredients (group_id, name, unit, quantity, catalog_id)
  values (g.id, '鶏むね肉', 'g', 0, (select id from ingredient_catalog where name = '鶏むね肉' and group_id is null)) returning id into breast;

  -- 鶏もも肉: 日付なし 50g、10日前 100g、今日 100g(合計 250g)
  perform adjust_ingredient_quantity(thigh, 50, false);
  perform adjust_ingredient_quantity(thigh, 100, true);
  update ingredient_batches set added_on = current_date - 10 where ingredient_id = thigh and added_on = current_date;
  perform adjust_ingredient_quantity(thigh, 100, true);
  perform adjust_ingredient_quantity(breast, 300, true);
  assert (select quantity from ingredients where id = thigh) = 250;

  insert into recipes (group_id, title) values (g.id, '唐揚げ') returning id into r;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity) values (r, thigh, 200);
  perform set_config('test.recipe', r::text, false);
  perform set_config('test.thigh', thigh::text, false);
  perform set_config('test.breast', breast::text, false);

  -- 1. 調理: 期限の近い順(推定期限は購入日 + 日持ち日数)にロットを消費し、日付なしは最後。記録が残る
  log1 := cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', thigh, 'quantity', 120)), '11111111-1111-4111-8111-111111111111');
  assert (select quantity from ingredients where id = thigh) = 130, '250 - 120 = 130';
  assert not exists (select 1 from ingredient_batches where ingredient_id = thigh and added_on = current_date - 10), '10日前のロットから先に消費';
  assert (select quantity from ingredient_batches where ingredient_id = thigh and added_on = current_date) = 80, '次に今日のロットから20';
  assert (select quantity from ingredient_batches where ingredient_id = thigh and added_on is null) = 50, '日付なしロットは最後まで残る';
  assert (select used_quantity from cook_log_items where cook_log_id = log1) = 120, '記録に使用量';

  -- 2. 二重送信: 同じ request_id は1回だけ
  log2 := cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', thigh, 'quantity', 120)), '11111111-1111-4111-8111-111111111111');
  assert log2 = log1, '同じ記録を返す';
  assert (select quantity from ingredients where id = thigh) = 130, '二重には差し引かない';
  assert (select count(*) from cook_logs) = 1, '記録は1件';

  -- 3. 代替: もも肉が足りない分をむね肉で(在庫より多くは差し引かない)
  log2 := cook_recipe_v2(r, jsonb_build_array(
    jsonb_build_object('ingredient_id', thigh, 'quantity', 500),
    jsonb_build_object('ingredient_id', breast, 'quantity', 70, 'substitute_for', '鶏もも肉')
  ), '22222222-2222-4222-8222-222222222222');
  assert (select quantity from ingredients where id = thigh) = 0, '在庫(130)以上は引かず 0';
  assert (select quantity from ingredients where id = breast) = 230, 'むね肉は 300 - 70';
  assert (select used_quantity from cook_log_items where cook_log_id = log2 and ingredient_id = thigh) = 130, '実際に引いたのは130';
  assert (select requested_quantity from cook_log_items where cook_log_id = log2 and ingredient_id = thigh) = 500, '指定は500';
  assert (select substitute_for from cook_log_items where cook_log_id = log2 and ingredient_id = breast) = '鶏もも肉', '代替の記録';
  assert not exists (select 1 from ingredient_batches where ingredient_id = thigh), 'もも肉のロットはなくなる';

  -- 4. 取り消し: 量とロット(購入日)を戻す。2回目は何もしない
  assert undo_cook(log2), '取り消せる';
  assert (select quantity from ingredients where id = thigh) = 130, 'もも肉が130に戻る';
  assert (select quantity from ingredients where id = breast) = 300, 'むね肉が300に戻る';
  assert (select quantity from ingredient_batches where ingredient_id = thigh and added_on = current_date) = 80, '今日のロットが戻る';
  assert (select quantity from ingredient_batches where ingredient_id = thigh and added_on is null) = 50, '日付なしロットが戻る';
  assert not undo_cook(log2), '2回目の取り消しは何もしない';
  assert (select quantity from ingredients where id = thigh) = 130, '二重には戻さない';

  assert undo_cook(log1), '最初の調理も取り消せる';
  assert (select quantity from ingredients where id = thigh) = 250, '元の250に戻る';
  assert (select quantity from ingredient_batches where ingredient_id = thigh and added_on = current_date - 10) = 100, '10日前のロットも戻る';
  assert (select coalesce(sum(quantity), 0) from ingredient_batches where ingredient_id = thigh) = 250, 'ロットの合計も250';

  -- 5. 不正な指定
  begin
    perform cook_recipe_v2(r, '{}'::jsonb, gen_random_uuid());
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '材料の指定が正しくありません', sqlerrm;
  end;

  -- 6. クライアントは記録を直接書き換えられない
  begin
    insert into cook_logs (group_id, recipe_title, request_id) values (g.id, 'x', gen_random_uuid());
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update cook_logs set undone_at = now();
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from cook_log_batch_usages;
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;

  -- 7. 代替ルール: 共通のルールが読め、家庭で無効化・追加できる
  assert exists (
    select 1 from ingredient_substitutions s
    join ingredient_catalog f on f.id = s.from_catalog_id join ingredient_catalog t on t.id = s.to_catalog_id
    where f.name = '白菜' and t.name = 'キャベツ' and s.group_id is null and s.ratio = 1.5
  ), '共通のルール 白菜→キャベツ';
  assert not exists (
    select 1 from ingredient_substitutions s
    join ingredient_catalog f on f.id = s.from_catalog_id join ingredient_catalog t on t.id = s.to_catalog_id
    where f.name = '牛乳' and t.name = '生クリーム'
  ), '生クリーム→牛乳 はあっても 牛乳→生クリーム はない(方向がある)';
  assert (select count(*) from ingredient_substitutions where group_id is null) >= 50, '共通のルールは50組以上';

  insert into substitution_opt_outs (group_id, substitution_id)
  select g.id, s.id from ingredient_substitutions s join ingredient_catalog f on f.id = s.from_catalog_id
  join ingredient_catalog t on t.id = s.to_catalog_id where f.name = '白菜' and t.name = 'キャベツ' and s.group_id is null;
  insert into ingredient_substitutions (from_catalog_id, to_catalog_id, ratio, group_id)
  values ((select id from ingredient_catalog where name = 'キャベツ' and group_id is null),
          (select id from ingredient_catalog where name = 'レタス' and group_id is null), 1, g.id);
  begin
    insert into ingredient_substitutions (from_catalog_id, to_catalog_id, ratio)
    values ((select id from ingredient_catalog where name = 'トマト' and group_id is null),
            (select id from ingredient_catalog where name = 'ミニトマト' and group_id is null), 1);
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
  delete from ingredient_substitutions where group_id is null;
  get diagnostics n = row_count;
  assert n = 0, '共通のルールは削除できない';
end $$;

-- 8. 別の家庭は、調理・取り消し・記録・家庭のルールに触れない
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e8', false);
do $$
begin
  assert (select count(*) from cook_logs) = 0, '他の家庭の記録は見えない';
  assert (select count(*) from cook_log_items) = 0, '他の家庭の記録の明細は見えない';
  assert (select count(*) from substitution_opt_outs) = 0, '他の家庭の無効化は見えない';
  assert (select count(*) from ingredient_substitutions where group_id is not null) = 0, '他の家庭のルールは見えない';
  begin
    perform cook_recipe_v2(current_setting('test.recipe')::uuid,
      jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.thigh'), 'quantity', 1)), gen_random_uuid());
    raise exception 'should have failed';
  exception when others then
    assert sqlerrm = '権限がありません', sqlerrm;
  end;
end $$;
-- 自分のレシピでも、他の家庭の食材は指定できない
do $$
declare r uuid;
begin
  insert into recipes (group_id, title) values (my_group_id(), '自分のレシピ') returning id into r;
  perform cook_recipe_v2(r, jsonb_build_array(jsonb_build_object('ingredient_id', current_setting('test.thigh'), 'quantity', 1)), gen_random_uuid());
  raise exception 'should have failed';
exception when others then
  assert sqlerrm = '権限がありません', sqlerrm;
end $$;

reset role;
do $$
begin
  assert (select quantity from ingredients where id = current_setting('test.thigh')::uuid) = 250, '他の家庭の操作で在庫は変わらない';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e8', false);
do $$
begin
  perform undo_cook((select id from cook_logs limit 1));
  raise exception 'should have failed';
exception when others then
  assert sqlerrm = '権限がありません', sqlerrm;
end $$;

reset role;
set role anon;
do $$
begin
  perform cook_recipe_v2(gen_random_uuid(), '[]'::jsonb, gen_random_uuid());
  raise exception 'should have failed';
exception when insufficient_privilege then null;
end $$;

reset role;
\echo 'cooking.test.sql: all assertions passed'
