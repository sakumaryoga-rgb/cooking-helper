-- 023: 自分で考えたレシピと、保存したレシピのカスタマイズ
--
-- 何度実行しても同じ結果になる。既存のレシピ・材料は変更しない(列の追加だけ。既存の行は空のまま)。
-- 1. recipes に作り方(instructions)・メモ(memo)・料理の絵(icon)を追加
-- 2. update_recipe: 料理名・人数・作り方・メモ・絵と、材料の一覧を1つのトランザクションで差し替える。
--    security invoker なので、呼んだ人の RLS(選んでいる家のレシピだけ書き込める)がそのまま効く。
--    材料は同じ家の食材だけを受け付ける。調理の記録は材料の行を参照しないため、差し替えても影響しない

alter table recipes add column if not exists instructions text;
alter table recipes add column if not exists memo text;
alter table recipes add column if not exists icon text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_instructions_length') then
    alter table recipes add constraint recipes_instructions_length check (instructions is null or char_length(instructions) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipes_memo_length') then
    alter table recipes add constraint recipes_memo_length check (memo is null or char_length(memo) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipes_icon_length') then
    alter table recipes add constraint recipes_icon_length check (icon is null or char_length(icon) between 1 and 16);
  end if;
end $$;

-- p_items: [{ "ingredient_id": uuid, "required_quantity": number, "raw_text": text | null }, ...]
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
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where (e ->> 'required_quantity') is null or (e ->> 'required_quantity')::numeric <= 0
  ) then
    raise exception '材料の分量を入れてください';
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
    where not exists (select 1 from ingredients i where i.id = (e ->> 'ingredient_id')::uuid and i.group_id = v_group)
  ) then
    raise exception 'この家にない食材は材料にできません';
  end if;

  delete from recipe_ingredients where recipe_id = p_recipe_id;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text)
  select p_recipe_id,
         (e ->> 'ingredient_id')::uuid,
         round(sum((e ->> 'required_quantity')::numeric), 2),
         left(string_agg(nullif(e ->> 'raw_text', ''), ' / '), 200)
  from jsonb_array_elements(p_items) e
  group by (e ->> 'ingredient_id')::uuid;

  return p_recipe_id;
end;
$$;

revoke all on function update_recipe(uuid, text, int, text, text, text, jsonb) from public, anon;
grant execute on function update_recipe(uuid, text, int, text, text, text, jsonb) to authenticated;
