-- 025: オリジナルレシピの手順ごとに、使う材料と量を記録する
--
-- 何度実行しても同じ結果になる。既存のレシピ・材料・作り方(instructions)は変更しない。
-- 1. recipes.steps(jsonb): [{ "text": 手順の文, "uses": [{ "ingredient_id": uuid | "source_name": 確認待ちの材料名, "quantity": 数 | null }] }]
--    - 手順の文は instructions(1手順1行)にも従来どおり入れる(古いアプリ・表示の互換)
--    - 手順ごとの量は表示の目安。在庫の減算はレシピ全体の材料の分量(recipe_ingredients)だけで行い、手順の量では減らさない
--      (二重に減らない)。手順の量の合計がレシピの分量と違っても自動で直さない(画面で知らせる)
-- 2. update_recipe に p_steps(省略可)を追加。省略(null)なら手順の記録は変えない。
--    手順で使う材料は、そのレシピの材料(p_items の食材・確認待ちの名前)だけ
-- 旧 update_recipe(7引数)は消して、同じ名前の8引数(最後は省略可)にする。名前付きの7引数の呼び出し(v1.16.0)もそのまま動く

alter table recipes add column if not exists steps jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_steps_shape') then
    alter table recipes add constraint recipes_steps_shape
      check (steps is null or (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 30 and pg_column_size(steps) <= 65536));
  end if;
end $$;

drop function if exists update_recipe(uuid, text, int, text, text, text, jsonb);

create or replace function update_recipe(
  p_recipe_id uuid,
  p_title text,
  p_servings int,
  p_instructions text,
  p_memo text,
  p_icon text,
  p_items jsonb,
  p_steps jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_group uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if auth.uid() is null then
    raise exception '権限がありません';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception '料理名を入力してください(200文字まで)';
  end if;
  if p_servings is not null and p_servings not between 1 and 99 then
    raise exception '人数は1〜99にしてください';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '材料を1つ以上入れてください';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception '材料が多すぎます';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e ->> 'required_quantity', '') is not null and (e ->> 'required_quantity')::numeric <= 0
  ) then
    raise exception '材料の分量を入れてください';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e ->> 'ingredient_id', '') is null and nullif(btrim(coalesce(e ->> 'source_name', '')), '') is null
  ) then
    raise exception '材料の名前がありません';
  end if;

  -- 手順: 形と、使う材料がこのレシピの材料であること
  if p_steps is not null then
    if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 30 then
      raise exception '手順の形が正しくありません';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_steps) s
      where jsonb_typeof(s) <> 'object'
         or char_length(coalesce(s ->> 'text', '')) > 500
         or (s ? 'uses' and (jsonb_typeof(s -> 'uses') <> 'array' or jsonb_array_length(s -> 'uses') > 30))
    ) then
      raise exception '手順の形が正しくありません';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_steps) s, jsonb_array_elements(coalesce(s -> 'uses', '[]'::jsonb)) u
      where (nullif(u ->> 'quantity', '') is not null and (u ->> 'quantity')::numeric <= 0)
         or not (
           (nullif(u ->> 'ingredient_id', '') is not null and exists (
             select 1 from jsonb_array_elements(p_items) e where e ->> 'ingredient_id' = u ->> 'ingredient_id'))
           or (nullif(u ->> 'source_name', '') is not null and exists (
             select 1 from jsonb_array_elements(p_items) e where nullif(e ->> 'ingredient_id', '') is null and btrim(e ->> 'source_name') = btrim(u ->> 'source_name')))
         )
    ) then
      raise exception '手順で使う材料は、このレシピの材料から選んでください';
    end if;
  end if;

  -- RLS: 選んでいる家のレシピでなければ0行(= 権限なし)
  update recipes set
    title = v_title,
    servings = p_servings,
    instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
    memo = nullif(btrim(coalesce(p_memo, '')), ''),
    icon = nullif(btrim(coalesce(p_icon, '')), ''),
    steps = case when p_steps is null then steps when jsonb_array_length(p_steps) = 0 then null else p_steps end
  where id = p_recipe_id
  returning group_id into v_group;
  if v_group is null then
    raise exception '権限がありません';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e ->> 'ingredient_id', '') is not null
      and not exists (select 1 from ingredients i where i.id = (e ->> 'ingredient_id')::uuid and i.group_id = v_group)
  ) then
    raise exception 'この家にない食材は材料にできません';
  end if;

  delete from recipe_ingredients where recipe_id = p_recipe_id;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text, amount_text, note)
  select p_recipe_id,
         (e ->> 'ingredient_id')::uuid,
         case when bool_and(nullif(e ->> 'required_quantity', '') is not null)
              then round(sum((e ->> 'required_quantity')::numeric), 2) end,
         left(string_agg(nullif(e ->> 'raw_text', ''), ' / '), 200),
         left(string_agg(nullif(e ->> 'amount_text', ''), ' + '), 60),
         left(string_agg(distinct nullif(e ->> 'note', ''), '・'), 60)
  from jsonb_array_elements(p_items) e
  where nullif(e ->> 'ingredient_id', '') is not null
  group by (e ->> 'ingredient_id')::uuid;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text, amount_text, source_name, note)
  select p_recipe_id, null,
         nullif(e ->> 'required_quantity', '')::numeric,
         left(nullif(e ->> 'raw_text', ''), 200),
         left(nullif(e ->> 'amount_text', ''), 60),
         left(btrim(e ->> 'source_name'), 80),
         left(nullif(e ->> 'note', ''), 60)
  from jsonb_array_elements(p_items) e
  where nullif(e ->> 'ingredient_id', '') is null;

  return p_recipe_id;
end;
$$;

revoke all on function update_recipe(uuid, text, int, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function update_recipe(uuid, text, int, text, text, text, jsonb, jsonb) to authenticated;
