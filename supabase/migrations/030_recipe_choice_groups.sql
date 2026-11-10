-- 030: レシピの「どれか1つ」の材料(合い挽き肉 300g / 牛ひき肉 300g / 豚こま 250g のような候補)
--
-- 何度実行しても同じ結果になる。既存のレシピ・材料・在庫・作った記録は削除・変更しない。
-- 1. recipe_ingredients.choice_group(null = ふつうの材料。同じレシピで同じ番号の材料は「どれか1つ」の候補)
--    - 候補ごとに食材・分量・単位を持つ(既存の列のまま)。既存の材料はすべて null のまま
--    - 候補が1つしかない組は null に直す。組の中に必須の候補があれば、組の候補はすべて必須にそろえる
-- 2. update_recipe: 材料の choice_group(1〜50 または null)を保存する。指定がない材料(古いアプリ)は今の組を引き継ぐ
--    同じ食材をまとめたときは、どれかが組に入っていなければ単独の材料にする
-- 3. cook_recipe_v2: 同じ組の候補を2つ以上引こうとしたら拒否する(古いアプリが候補をすべて引かないように)
-- 4. cook_recipe(旧版用): 組の材料は引かない
-- アプリは v1.35.0 から組を扱う。この migration を適用してから v1.35.0(最低対応バージョン 1.35.0)を公開する。
-- 適用後・公開前の v1.34.0 でも動く(組はまだ作れないため、今までと同じ)

alter table recipe_ingredients add column if not exists choice_group smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipe_ingredients_choice_group_range') then
    alter table recipe_ingredients add constraint recipe_ingredients_choice_group_range
      check (choice_group is null or choice_group between 1 and 50);
  end if;
end $$;

create index if not exists recipe_ingredients_choice_group_idx
  on recipe_ingredients (recipe_id, choice_group) where choice_group is not null;

-- 材料の行(p_items の要素)の組の番号。指定がなければ今の組(v_prev: キー → 番号)を引き継ぐ
create or replace function item_choice_group(p_item jsonb, p_prev jsonb, p_key text)
returns smallint
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when p_item ? 'choice_group' then nullif(p_item ->> 'choice_group', '')::smallint
    else nullif(p_prev ->> p_key, '')::smallint
  end
$$;
revoke all on function item_choice_group(jsonb, jsonb, text) from public, anon;
grant execute on function item_choice_group(jsonb, jsonb, text) to authenticated;

-- レシピの組を整える: 候補が1つの組は解除し、組の中に必須があれば組をすべて必須にする
-- (呼び出し元の権限で動く。RLS で選んでいる家のレシピだけが変わる)
create or replace function normalize_choice_groups(p_recipe_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  update recipe_ingredients ri set choice_group = null
  where ri.recipe_id = p_recipe_id and ri.choice_group is not null
    and (select count(*) from recipe_ingredients x where x.recipe_id = p_recipe_id and x.choice_group = ri.choice_group) < 2;
  update recipe_ingredients ri set optional = false
  where ri.recipe_id = p_recipe_id and ri.choice_group is not null and ri.optional
    and exists (select 1 from recipe_ingredients x where x.recipe_id = p_recipe_id and x.choice_group = ri.choice_group and not x.optional);
end;
$$;
revoke all on function normalize_choice_groups(uuid) from public, anon;
grant execute on function normalize_choice_groups(uuid) to authenticated;

-- ------------------------------------------------------------
-- レシピの編集(「どれか1つ」の組を保存する。それ以外は 028 と同じ)
-- ------------------------------------------------------------
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
  v_prev_group jsonb;
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
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where e ? 'choice_group' and jsonb_typeof(e -> 'choice_group') <> 'null'
      and (jsonb_typeof(e -> 'choice_group') <> 'number' or (e ->> 'choice_group') !~ '^[0-9]{1,2}$' or (e ->> 'choice_group')::int not between 1 and 50)
  ) then
    raise exception '「どれか1つ」の材料の指定が正しくありません';
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
  -- 今の「どれか1つ」の組(choice_group の指定がない材料は引き継ぐ。古いアプリの編集で組が消えて全部必須にならないように)
  select coalesce(jsonb_object_agg(coalesce(ingredient_id::text, 's:' || btrim(source_name)), choice_group), '{}'::jsonb)
    into v_prev_group
  from recipe_ingredients where recipe_id = p_recipe_id;

  delete from recipe_ingredients where recipe_id = p_recipe_id;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text, amount_text, note, optional, choice_group)
  select p_recipe_id,
         (e ->> 'ingredient_id')::uuid,
         case when bool_and(nullif(e ->> 'required_quantity', '') is not null)
              then round(sum((e ->> 'required_quantity')::numeric), 2) end,
         left(string_agg(nullif(e ->> 'raw_text', ''), ' / '), 200),
         left(string_agg(nullif(e ->> 'amount_text', ''), ' + '), 60),
         left(string_agg(distinct nullif(e ->> 'note', ''), '・'), 60),
         -- 同じ食材をまとめたときは、どれかが必須なら必須
         bool_and(coalesce((e ->> 'optional')::boolean, (v_prev ->> (e ->> 'ingredient_id'))::boolean, false)),
         -- 同じ食材をまとめたときは、どれかが組に入っていなければ組に入れない(単独の材料を優先)
         case when bool_or(item_choice_group(e, v_prev_group, e ->> 'ingredient_id') is null) then null
              else min(item_choice_group(e, v_prev_group, e ->> 'ingredient_id')) end
  from jsonb_array_elements(p_items) e
  where nullif(e ->> 'ingredient_id', '') is not null
  group by (e ->> 'ingredient_id')::uuid;
  insert into recipe_ingredients (recipe_id, ingredient_id, required_quantity, raw_text, amount_text, source_name, note, optional, choice_group)
  select p_recipe_id, null,
         nullif(e ->> 'required_quantity', '')::numeric,
         left(nullif(e ->> 'raw_text', ''), 200),
         left(nullif(e ->> 'amount_text', ''), 60),
         left(btrim(e ->> 'source_name'), 80),
         left(nullif(e ->> 'note', ''), 60),
         coalesce((e ->> 'optional')::boolean, (v_prev ->> ('s:' || btrim(e ->> 'source_name')))::boolean, false),
         item_choice_group(e, v_prev_group, 's:' || btrim(e ->> 'source_name'))
  from jsonb_array_elements(p_items) e
  where nullif(e ->> 'ingredient_id', '') is null;

  perform normalize_choice_groups(p_recipe_id);

  return p_recipe_id;
end;
$$;

revoke all on function update_recipe(uuid, text, int, text, text, text, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function update_recipe(uuid, text, int, text, text, text, jsonb, jsonb, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 作った: 同じ組の候補を2つ以上引かない(それ以外は 028 と同じ)
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
  -- 任意の材料を知らない古いアプリ(kind なし)からの、任意の材料の減算は受け付けない(更新を求める)
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where not (e ? 'kind')
      and exists (
        select 1 from recipe_ingredients ri
        where ri.recipe_id = p_recipe_id and ri.ingredient_id = (e ->> 'ingredient_id')::uuid and ri.optional)
      and not exists (
        select 1 from recipe_ingredients ri
        where ri.recipe_id = p_recipe_id and ri.ingredient_id = (e ->> 'ingredient_id')::uuid and not ri.optional)
  ) then
    raise exception 'アプリを最新版に更新してください(任意の材料に対応していません)';
  end if;
  -- 「どれか1つ」の材料は、組ごとに1つだけ(代替・今回だけ追加は数えない)。
  -- 組を知らない古いアプリが、候補をすべて必須として引かないように(最低対応バージョン 1.35.0 と二重の守り)
  if exists (
    select ri.choice_group
    from jsonb_array_elements(p_items) e
    join recipe_ingredients ri on ri.recipe_id = p_recipe_id and ri.ingredient_id = (e ->> 'ingredient_id')::uuid
    where ri.choice_group is not null and coalesce(e ->> 'kind', 'required') in ('required', 'optional')
      and coalesce((e ->> 'quantity')::numeric, 0) > 0
    group by ri.choice_group
    having count(distinct ri.ingredient_id) > 1
  ) then
    raise exception 'アプリを最新版に更新してください(「どれか1つ」の材料は1つだけ選んでください)';
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

-- ------------------------------------------------------------
-- 作った(旧版のアプリ用): 任意の材料と「どれか1つ」の材料は引かない
-- ------------------------------------------------------------
create or replace function cook_recipe(p_recipe_id uuid, p_used jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r recipe_ingredients%rowtype;
  v_group uuid := my_group_id();
  v_recipe_group uuid;
  v_current numeric;
  v_use numeric;
begin
  select group_id into v_recipe_group from recipes where id = p_recipe_id;
  if v_recipe_group is null or v_recipe_group <> v_group then
    raise exception '権限がありません';
  end if;

  for r in select * from recipe_ingredients where recipe_id = p_recipe_id and not optional and choice_group is null order by ingredient_id loop
    select quantity into v_current from ingredients where id = r.ingredient_id and group_id = v_group for update;
    if not found then
      continue;
    end if;
    v_use := least(greatest(coalesce((p_used ->> r.ingredient_id::text)::numeric, r.required_quantity), 0), v_current);
    if v_use > 0 then
      perform consume_ingredient_batches(r.ingredient_id, v_use, null);
      update ingredients set quantity = quantity - v_use where id = r.ingredient_id;
    end if;
  end loop;
end;
$$;
