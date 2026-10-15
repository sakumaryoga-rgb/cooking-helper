-- 028: レシピの料理カテゴリと、材料の必須・任意。調理で「今回だけ追加した食材」を記録する
--
-- 何度実行しても同じ結果になる。既存のレシピ・材料・作った記録は削除・変更しない。
-- 1. recipes.category(料理カテゴリのキー: japanese / chinese / italian / western / korean / ethnic / other)
--    recipes.category_manual(利用者が選んだカテゴリ。true のものは自動の分類で上書きしない)
--    - 既存のレシピは category = null のまま(アプリが料理名と材料から分類して表示する。データは書き換えない)
--    - カテゴリの一覧はアプリ側で持つ(追加しやすいよう、DB では形だけを確かめる)
-- 2. recipe_ingredients.optional(任意の材料。既存の材料はすべて false = 必須のまま)
-- 3. update_recipe に p_category / p_category_manual(省略可)を追加。材料の optional を保存する。
--    材料に optional の指定がない(古いアプリ)ときは、同じ食材の今の設定を引き継ぐ(古いアプリの編集で任意が消えない)
--    旧 update_recipe(8引数)は消して、同じ名前の10引数(最後の2つは省略可)にする。名前付きの8引数の呼び出しもそのまま動く
-- 4. cook_recipe_v2: 材料ごとの kind(required / optional / substitute / extra)を確かめて記録する。
--    required・optional はこのレシピの材料だけ。extra(今回だけ追加)は自分の家の食材なら何でもよい(レシピは変えない)。
--    kind がない(古いアプリ)ときは従来どおり。取り消し(undo_cook)は記録した使用量をそのまま戻すので変更しない

alter table recipes add column if not exists category text;
alter table recipes add column if not exists category_manual boolean not null default false;
alter table recipe_ingredients add column if not exists optional boolean not null default false;
alter table cook_log_items add column if not exists kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_category_shape') then
    alter table recipes add constraint recipes_category_shape check (category is null or category ~ '^[a-z_]{1,30}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cook_log_items_kind_known') then
    alter table cook_log_items add constraint cook_log_items_kind_known
      check (kind is null or kind in ('required', 'optional', 'substitute', 'extra'));
  end if;
end $$;

-- ------------------------------------------------------------
-- レシピの編集(カテゴリ・材料の必須/任意)
-- ------------------------------------------------------------
drop function if exists update_recipe(uuid, text, int, text, text, text, jsonb, jsonb);

create or replace function update_recipe(
  p_recipe_id uuid,
  p_title text,
  p_servings int,
  p_instructions text,
  p_memo text,
  p_icon text,
  p_items jsonb,
  p_steps jsonb default null,
  p_category text default null,
  p_category_manual boolean default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_group uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_prev jsonb;
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
  if p_category is not null and p_category !~ '^[a-z_]{1,30}$' then
    raise exception 'カテゴリが正しくありません';
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
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where e ? 'optional' and jsonb_typeof(e -> 'optional') <> 'boolean'
  ) then
    raise exception '材料の必須・任意が正しくありません';
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
  -- カテゴリ: 利用者が選んだ(p_category_manual = true)ときはそのまま保存する。
  -- 自動の分類(false)は、利用者が選んだカテゴリを上書きしない。省略(null)なら変えない
  update recipes set
    title = v_title,
    servings = p_servings,
    instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
    memo = nullif(btrim(coalesce(p_memo, '')), ''),
    icon = nullif(btrim(coalesce(p_icon, '')), ''),
    steps = case when p_steps is null then steps when jsonb_array_length(p_steps) = 0 then null else p_steps end,
    category = case
      when p_category_manual is true then p_category
      when p_category_manual is false and not category_manual then coalesce(p_category, category)
      else category end,
    category_manual = case when p_category_manual is true then p_category is not null else category_manual end
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

  -- 今の必須・任意(optional の指定がない材料は、同じ食材・同じ確認待ちの名前の設定を引き継ぐ)
  select coalesce(jsonb_object_agg(coalesce(ingredient_id::text, 's:' || btrim(source_name)), optional), '{}'::jsonb)
    into v_prev
  from recipe_ingredients where recipe_id = p_recipe_id;

  delete from recipe_ingredients where recipe_id = p_recipe_id;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text, amount_text, note, optional)
  select p_recipe_id,
         (e ->> 'ingredient_id')::uuid,
         case when bool_and(nullif(e ->> 'required_quantity', '') is not null)
              then round(sum((e ->> 'required_quantity')::numeric), 2) end,
         left(string_agg(nullif(e ->> 'raw_text', ''), ' / '), 200),
         left(string_agg(nullif(e ->> 'amount_text', ''), ' + '), 60),
         left(string_agg(distinct nullif(e ->> 'note', ''), '・'), 60),
         -- 同じ食材をまとめたときは、どれかが必須なら必須
         bool_and(coalesce((e ->> 'optional')::boolean, (v_prev ->> (e ->> 'ingredient_id'))::boolean, false))
  from jsonb_array_elements(p_items) e
  where nullif(e ->> 'ingredient_id', '') is not null
  group by (e ->> 'ingredient_id')::uuid;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text, amount_text, source_name, note, optional)
  select p_recipe_id, null,
         nullif(e ->> 'required_quantity', '')::numeric,
         left(nullif(e ->> 'raw_text', ''), 200),
         left(nullif(e ->> 'amount_text', ''), 60),
         left(btrim(e ->> 'source_name'), 80),
         left(nullif(e ->> 'note', ''), 60),
         coalesce((e ->> 'optional')::boolean, (v_prev ->> ('s:' || btrim(e ->> 'source_name')))::boolean, false)
  from jsonb_array_elements(p_items) e
  where nullif(e ->> 'ingredient_id', '') is null;

  return p_recipe_id;
end;
$$;

revoke all on function update_recipe(uuid, text, int, text, text, text, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function update_recipe(uuid, text, int, text, text, text, jsonb, jsonb, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 作った: 使った材料の種類を確かめて記録する(在庫・ロットの処理は 015 と同じ)
-- ------------------------------------------------------------
create or replace function cook_recipe_v2(p_recipe_id uuid, p_items jsonb, p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
  v_user uuid := auth.uid();
  v_title text;
  v_log uuid;
  v_item record;
  v_ing ingredients;
  v_use numeric;
begin
  if v_user is null or v_group is null then
    raise exception '権限がありません';
  end if;
  select title into v_title from recipes where id = p_recipe_id and group_id = v_group;
  if v_title is null then
    raise exception '権限がありません';
  end if;
  if p_request_id is null then
    raise exception 'request_id が必要です';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 100 then
    raise exception '材料の指定が正しくありません';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or (e ? 'kind' and (e ->> 'kind') not in ('required', 'optional', 'substitute', 'extra'))
       or (nullif(e ->> 'quantity', '') is not null and (e ->> 'quantity')::numeric < 0)
  ) then
    raise exception '材料の指定が正しくありません';
  end if;
  -- 必須・任意の材料は、このレシピの材料だけ(今回だけ追加した食材は extra で送る)
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where (e ->> 'kind') in ('required', 'optional')
      and not exists (
        select 1 from recipe_ingredients ri
        where ri.recipe_id = p_recipe_id and ri.ingredient_id = (e ->> 'ingredient_id')::uuid)
  ) then
    raise exception 'このレシピの材料ではありません';
  end if;

  -- 同じ request_id の再送・連打は、最初の1回分だけ(2回目以降は在庫を変えない)
  insert into cook_logs (group_id, recipe_id, recipe_title, request_id, cooked_by)
  values (v_group, p_recipe_id, v_title, p_request_id, v_user)
  on conflict (group_id, request_id) do nothing
  returning id into v_log;
  if v_log is null then
    select id into v_log from cook_logs where group_id = v_group and request_id = p_request_id;
    return v_log;
  end if;

  for v_item in
    select (e ->> 'ingredient_id')::uuid as ingredient_id,
           sum(greatest(coalesce((e ->> 'quantity')::numeric, 0), 0)) as quantity,
           max(nullif(left(e ->> 'substitute_for', 40), '')) as substitute_for,
           -- 同じ食材を複数の行で送ったときは、レシピの材料としての記録を優先する
           (array_agg(e ->> 'kind' order by case e ->> 'kind' when 'required' then 0 when 'optional' then 1 when 'substitute' then 2 when 'extra' then 3 else 4 end))[1] as kind
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    select * into v_ing from ingredients where id = v_item.ingredient_id and group_id = v_group for update;
    if not found then
      raise exception '権限がありません';
    end if;
    if v_item.quantity > 1000000 then
      raise exception '数量が大きすぎます';
    end if;
    v_use := least(v_item.quantity, greatest(v_ing.quantity, 0));
    insert into cook_log_items (cook_log_id, ingredient_id, ingredient_name, unit, requested_quantity, used_quantity, substitute_for, kind)
    values (v_log, v_ing.id, v_ing.name, v_ing.unit, v_item.quantity, v_use, v_item.substitute_for, v_item.kind);
    if v_use > 0 then
      update ingredients set quantity = quantity - v_use where id = v_ing.id;
      perform consume_ingredient_batches(v_ing.id, v_use, v_log);
    end if;
  end loop;

  return v_log;
end;
$$;

revoke all on function cook_recipe_v2(uuid, jsonb, uuid) from public, anon;
grant execute on function cook_recipe_v2(uuid, jsonb, uuid) to authenticated;
