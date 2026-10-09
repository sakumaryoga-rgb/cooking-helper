-- 024: レシピの材料を、分量が分からない・食材が未確定のままでも保存できるようにする(レシピ取り込みの確認を減らす)
--
-- 何度実行しても同じ結果になる。既存のレシピ・材料・在庫・調理記録は変更しない(制約をゆるめ、列を足すだけ)。
-- 1. recipe_ingredients:
--    - required_quantity を空にできる(「1パック」「少々」など、食材の単位に直せない分量。元の表記は amount_text に残す)
--    - ingredient_id を空にできる(どの食材か未確定。元の食材名を source_name に残し、あとで詳細画面で選ぶ)
--    - amount_text(元の分量の表記)・source_name(元の食材名)・note(冷凍・皮なし などの状態)を追加
--    - 食材も元の食材名もない行は作れない
--    在庫の減算は、アプリが確定した数量だけを cook_recipe_v2 に渡す(分量が空の行は推測で減らさない)。
--    旧 cook_recipe も、分量が空なら減らさず、食材が空の行は飛ばす(既存の実装のまま)
-- 2. update_recipe: 上の列を受け付ける(security invoker のまま。同じ家の食材だけ)
-- 3. ingredient_unit_conversions: 家庭ごとの、確定した分量の換算(「豚こま切れ肉 1パック = 200g」)。
--    調理のときにユーザーが入れた量からだけ作る。読み取りは所属する家、書き込みは選んでいる家

-- ------------------------------------------------------------
-- 1. recipe_ingredients
-- ------------------------------------------------------------
alter table recipe_ingredients alter column required_quantity drop not null;
alter table recipe_ingredients alter column ingredient_id drop not null;
alter table recipe_ingredients add column if not exists amount_text text;
alter table recipe_ingredients add column if not exists source_name text;
alter table recipe_ingredients add column if not exists note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipe_ingredients_amount_text_length') then
    alter table recipe_ingredients add constraint recipe_ingredients_amount_text_length check (amount_text is null or char_length(amount_text) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipe_ingredients_source_name_length') then
    alter table recipe_ingredients add constraint recipe_ingredients_source_name_length check (source_name is null or char_length(source_name) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipe_ingredients_note_length') then
    alter table recipe_ingredients add constraint recipe_ingredients_note_length check (note is null or char_length(note) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipe_ingredients_target_present') then
    alter table recipe_ingredients add constraint recipe_ingredients_target_present check (ingredient_id is not null or source_name is not null);
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. update_recipe(引数は 023 と同じ。p_items の各要素に amount_text / source_name / note を追加で受け付ける)
--    p_items: [{ ingredient_id: uuid | null, required_quantity: number | null, raw_text, amount_text, source_name, note }]
-- ------------------------------------------------------------
create or replace function update_recipe(
  p_recipe_id uuid,
  p_title text,
  p_servings int,
  p_instructions text,
  p_memo text,
  p_icon text,
  p_items jsonb
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
  -- 分量は空か、0より大きい数
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e ->> 'required_quantity', '') is not null and (e ->> 'required_quantity')::numeric <= 0
  ) then
    raise exception '材料の分量を入れてください';
  end if;
  -- 食材か、元の食材名のどちらかは必要
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e ->> 'ingredient_id', '') is null and nullif(btrim(coalesce(e ->> 'source_name', '')), '') is null
  ) then
    raise exception '材料の名前がありません';
  end if;

  -- RLS: 選んでいる家のレシピでなければ0行(= 権限なし)
  update recipes set
    title = v_title,
    servings = p_servings,
    instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
    memo = nullif(btrim(coalesce(p_memo, '')), ''),
    icon = nullif(btrim(coalesce(p_icon, '')), '')
  where id = p_recipe_id
  returning group_id into v_group;
  if v_group is null then
    raise exception '権限がありません';
  end if;

  -- 材料は同じ家の食材だけ
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e ->> 'ingredient_id', '') is not null
      and not exists (select 1 from ingredients i where i.id = (e ->> 'ingredient_id')::uuid and i.group_id = v_group)
  ) then
    raise exception 'この家にない食材は材料にできません';
  end if;

  delete from recipe_ingredients where recipe_id = p_recipe_id;
  -- 同じ食材の行は1つにまとめる(分量が1つでも空なら、合計も空にして元の表記をつなぐ)
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
  -- 未確定の行(食材が空)はそのまま入れる
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

revoke all on function update_recipe(uuid, text, int, text, text, text, jsonb) from public, anon;
grant execute on function update_recipe(uuid, text, int, text, text, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 3. 家庭ごとの分量の換算
-- ------------------------------------------------------------
create table if not exists ingredient_unit_conversions (
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  unit text not null,
  -- 1 unit が、その食材の単位(ingredients.unit)でいくつか
  amount numeric not null,
  updated_at timestamptz not null default now(),
  primary key (ingredient_id, unit),
  constraint ingredient_unit_conversions_unit_length check (char_length(unit) between 1 and 20),
  constraint ingredient_unit_conversions_amount_range check (amount > 0 and amount <= 100000)
);

alter table ingredient_unit_conversions enable row level security;
revoke all on table ingredient_unit_conversions from anon;

drop policy if exists "read member unit conversions" on ingredient_unit_conversions;
drop policy if exists "write active group unit conversions" on ingredient_unit_conversions;
create policy "read member unit conversions" on ingredient_unit_conversions for select to authenticated
  using (exists (select 1 from ingredients i where i.id = ingredient_unit_conversions.ingredient_id and is_group_member(i.group_id)));
create policy "write active group unit conversions" on ingredient_unit_conversions for all to authenticated
  using (exists (select 1 from ingredients i where i.id = ingredient_unit_conversions.ingredient_id and i.group_id = my_group_id()))
  with check (exists (select 1 from ingredients i where i.id = ingredient_unit_conversions.ingredient_id and i.group_id = my_group_id()));
