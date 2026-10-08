-- COOKDOOR v1.5.0(Phase 4): 代替食材と、調理時の在庫消費(履歴・取り消し・二重実行の防止)
--
-- 1. ingredient_substitutions: 「A の代わりに B を使える」ルール。方向がある(A→B があっても B→A があるとは限らない)。
--    ratio は「A を 1(A の単位)使うところを、B を ratio(B の単位)使う」。単位は食材マスタの単位。
--    共通のルール(group_id が null、運営者が登録)と、家庭のルールがある。
--    substitution_opt_outs: 家庭ごとに、共通のルールを使わないようにする。
-- 2. cook_logs / cook_log_items / cook_log_batch_usages: 「作った」の記録。実際に差し引いた量と、
--    どのロット(購入日)から差し引いたかを残し、取り消しで元に戻す。
--    同じ request_id の調理は1回しか反映しない(二重送信の防止)。
-- 3. cook_recipe_v2 / undo_cook: 調理と取り消しの RPC。食材の行をロックして、同時操作でも在庫を壊さない。
--    在庫より多くは差し引かない。旧 cook_recipe は旧版のアプリのために残す。
--
-- 既存のテーブル・データは変更しない。何度実行しても同じ結果になる。SQL Editor で全体をそのまま実行する。

-- ------------------------------------------------------------
-- 1. 代替ルール
-- ------------------------------------------------------------
create table if not exists ingredient_substitutions (
  id uuid primary key default gen_random_uuid(),
  from_catalog_id uuid not null references ingredient_catalog(id) on delete cascade,
  to_catalog_id uuid not null references ingredient_catalog(id) on delete cascade,
  ratio numeric not null,
  note text,
  group_id uuid references groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint ingredient_substitutions_ratio_range check (ratio > 0 and ratio <= 1000),
  constraint ingredient_substitutions_not_self check (from_catalog_id <> to_catalog_id),
  constraint ingredient_substitutions_note_length check (note is null or char_length(note) <= 100)
);
create unique index if not exists ingredient_substitutions_common_idx
  on ingredient_substitutions (from_catalog_id, to_catalog_id) where group_id is null;
create unique index if not exists ingredient_substitutions_group_idx
  on ingredient_substitutions (group_id, from_catalog_id, to_catalog_id) where group_id is not null;

alter table ingredient_substitutions enable row level security;
revoke all on table ingredient_substitutions from anon;
drop policy if exists "read common and own substitutions" on ingredient_substitutions;
drop policy if exists "insert own substitutions" on ingredient_substitutions;
drop policy if exists "delete own substitutions" on ingredient_substitutions;
create policy "read common and own substitutions" on ingredient_substitutions
  for select to authenticated using (group_id is null or group_id = my_group_id());
create policy "insert own substitutions" on ingredient_substitutions
  for insert to authenticated
  with check (
    group_id is not null and group_id = my_group_id()
    and exists (select 1 from ingredient_catalog c where c.id = from_catalog_id and (c.group_id is null or c.group_id = my_group_id()))
    and exists (select 1 from ingredient_catalog c where c.id = to_catalog_id and (c.group_id is null or c.group_id = my_group_id()))
  );
create policy "delete own substitutions" on ingredient_substitutions
  for delete to authenticated using (group_id is not null and group_id = my_group_id());

create table if not exists substitution_opt_outs (
  group_id uuid not null references groups(id) on delete cascade,
  substitution_id uuid not null references ingredient_substitutions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, substitution_id)
);
alter table substitution_opt_outs enable row level security;
revoke all on table substitution_opt_outs from anon;
drop policy if exists "manage own opt outs" on substitution_opt_outs;
create policy "manage own opt outs" on substitution_opt_outs
  for all to authenticated
  using (group_id = my_group_id())
  with check (group_id = my_group_id());

-- 共通の代替ルール(初期データ)。共通の食材マスタの品目どうしにだけ付ける
insert into ingredient_substitutions (from_catalog_id, to_catalog_id, ratio, note)
select f.id, t.id, s.ratio, s.note
from (values
  ('鶏もも肉', '鶏むね肉', 1, null), ('鶏むね肉', '鶏もも肉', 1, null),
  ('鶏むね肉', '鶏ささみ', 1, null), ('鶏ささみ', '鶏むね肉', 1, null),
  ('豚こま切れ肉', '豚バラ肉', 1, null), ('豚バラ肉', '豚こま切れ肉', 1, null),
  ('豚こま切れ肉', '牛こま切れ肉', 1, null), ('牛こま切れ肉', '豚こま切れ肉', 1, null),
  ('豚ロース肉', '豚肩ロース肉', 1, null), ('豚肩ロース肉', '豚ロース肉', 1, null),
  ('豚こま切れ肉', '豚肩ロース肉', 1, '薄切りにして使う'), ('牛バラ肉', '牛こま切れ肉', 1, null),
  ('合いびき肉', '豚ひき肉', 1, null), ('合いびき肉', '牛ひき肉', 1, null),
  ('豚ひき肉', '合いびき肉', 1, null), ('牛ひき肉', '合いびき肉', 1, null),
  ('鶏ひき肉', '豚ひき肉', 1, null), ('豚ひき肉', '鶏ひき肉', 1, null),
  ('ベーコン', 'ハム', 1, null), ('ハム', 'ベーコン', 1, null),
  ('ソーセージ', 'ウインナー', 1, null), ('ウインナー', 'ソーセージ', 1, null),
  ('白菜', 'キャベツ', 1.5, '白菜1玉はキャベツ約1.5玉'), ('キャベツ', '白菜', 0.6, null),
  ('小松菜', 'ほうれん草', 1, null), ('ほうれん草', '小松菜', 1, null),
  ('チンゲン菜', '小松菜', 0.5, null), ('小松菜', 'チンゲン菜', 2, null),
  ('万能ねぎ(小ねぎ)', '長ねぎ', 1, '青い部分を使う'), ('長ねぎ', '玉ねぎ', 0.5, '加熱する料理だけ'),
  ('ピーマン', 'パプリカ', 0.5, null), ('パプリカ', 'ピーマン', 2, null),
  ('ナス', 'ズッキーニ', 0.5, null), ('ズッキーニ', 'ナス', 2, null),
  ('しめじ', 'まいたけ', 1, null), ('まいたけ', 'しめじ', 1, null),
  ('しめじ', 'エリンギ', 1, null), ('エリンギ', 'しめじ', 1, null), ('えのき', 'しめじ', 1, null),
  ('さやいんげん', 'スナップエンドウ', 1, null), ('スナップエンドウ', 'さやいんげん', 1, null),
  ('ブロッコリー', 'カリフラワー', 1, null), ('カリフラワー', 'ブロッコリー', 1, null),
  ('鮭(切り身)', 'タラ(切り身)', 1, null), ('タラ(切り身)', '鮭(切り身)', 1, null),
  ('サバ(切り身)', 'ブリ(切り身)', 1, null), ('ブリ(切り身)', 'サバ(切り身)', 1, null),
  ('生クリーム', '牛乳', 1, 'コクは弱くなる'), ('牛乳', '豆乳', 1, null), ('豆乳', '牛乳', 1, null),
  ('木綿豆腐', '絹豆腐', 1, null), ('絹豆腐', '木綿豆腐', 1, null),
  ('スライスチーズ', 'ピザ用チーズ', 18, '1枚は約18g'),
  ('白だし', 'めんつゆ', 1, null), ('めんつゆ', '白だし', 1, null),
  ('顆粒コンソメ', '鶏がらスープの素', 1, null), ('鶏がらスープの素', '顆粒コンソメ', 1, null),
  ('サラダ油', 'オリーブオイル', 1, null), ('オリーブオイル', 'サラダ油', 1, null),
  ('片栗粉', '小麦粉', 1, '揚げ衣に使う場合'), ('小麦粉', '片栗粉', 1, '揚げ衣に使う場合'),
  ('白ごま', 'すりごま', 1, null), ('すりごま', '白ごま', 1, null),
  ('みりん', '砂糖', 0.33, 'みりん大さじ1は砂糖小さじ1')
) as s(from_name, to_name, ratio, note)
join ingredient_catalog f on f.name = s.from_name and f.group_id is null
join ingredient_catalog t on t.name = s.to_name and t.group_id is null
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. 調理の記録
-- ------------------------------------------------------------
create table if not exists cook_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  recipe_id uuid references recipes(id) on delete set null,
  recipe_title text not null,
  request_id uuid not null,
  cooked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null
);
create unique index if not exists cook_logs_request_idx on cook_logs (group_id, request_id);
create index if not exists cook_logs_recipe_created_idx on cook_logs (recipe_id, created_at desc);

create table if not exists cook_log_items (
  id uuid primary key default gen_random_uuid(),
  cook_log_id uuid not null references cook_logs(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  ingredient_name text not null,
  unit text not null,
  requested_quantity numeric not null check (requested_quantity >= 0),
  used_quantity numeric not null check (used_quantity >= 0),
  substitute_for text
);
create index if not exists cook_log_items_log_idx on cook_log_items (cook_log_id);

create table if not exists cook_log_batch_usages (
  id uuid primary key default gen_random_uuid(),
  cook_log_id uuid not null references cook_logs(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  added_on date,
  quantity numeric not null check (quantity > 0)
);
create index if not exists cook_log_batch_usages_log_idx on cook_log_batch_usages (cook_log_id);

alter table cook_logs enable row level security;
alter table cook_log_items enable row level security;
alter table cook_log_batch_usages enable row level security;
-- クライアントは自分のグループの記録を読むだけ。書き込みは RPC だけで行う
revoke all on table cook_logs from anon, authenticated;
revoke all on table cook_log_items from anon, authenticated;
revoke all on table cook_log_batch_usages from anon, authenticated;
grant select on table cook_logs to authenticated;
grant select on table cook_log_items to authenticated;
drop policy if exists "read own cook logs" on cook_logs;
create policy "read own cook logs" on cook_logs
  for select to authenticated using (group_id = my_group_id());
drop policy if exists "read own cook log items" on cook_log_items;
create policy "read own cook log items" on cook_log_items
  for select to authenticated
  using (exists (select 1 from cook_logs l where l.id = cook_log_id and l.group_id = my_group_id()));

-- ------------------------------------------------------------
-- 3. 調理(在庫を差し引き、記録する)
-- ------------------------------------------------------------
-- p_items: [{ "ingredient_id": "...", "quantity": 200, "substitute_for": "鶏もも肉"(任意) }, ...]
-- 戻り値: 調理記録の ID(同じ p_request_id なら、前回の記録の ID を返し、在庫は差し引かない)
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
  v_remaining numeric;
  b record;
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

  -- 二重送信: 同じ request_id の記録があれば何もしない(同時に届いた場合は一意インデックスで後の方が待ち、ここで止まる)
  insert into cook_logs (group_id, recipe_id, recipe_title, request_id, cooked_by)
  values (v_group, p_recipe_id, v_title, p_request_id, v_user)
  on conflict (group_id, request_id) do nothing
  returning id into v_log;
  if v_log is null then
    select id into v_log from cook_logs where group_id = v_group and request_id = p_request_id;
    return v_log;
  end if;

  -- 同じ食材の指定はまとめ、食材の ID 順にロックする(同時操作でのデッドロックを避ける)
  for v_item in
    select (e ->> 'ingredient_id')::uuid as ingredient_id,
           sum(greatest(coalesce((e ->> 'quantity')::numeric, 0), 0)) as quantity,
           max(nullif(left(e ->> 'substitute_for', 40), '')) as substitute_for
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

    -- 在庫より多くは差し引かない
    v_use := least(v_item.quantity, greatest(v_ing.quantity, 0));

    insert into cook_log_items (cook_log_id, ingredient_id, ingredient_name, unit, requested_quantity, used_quantity, substitute_for)
    values (v_log, v_ing.id, v_ing.name, v_ing.unit, v_item.quantity, v_use, v_item.substitute_for);

    if v_use > 0 then
      update ingredients set quantity = quantity - v_use where id = v_ing.id;

      -- ロットは既存の消費順(日付なし → 購入日の古い順)で差し引き、どのロットからかを記録する
      v_remaining := v_use;
      for b in
        select * from ingredient_batches
        where ingredient_id = v_ing.id and quantity > 0
        order by (added_on is null) desc, added_on, created_at
        for update
      loop
        exit when v_remaining <= 0;
        if b.quantity <= v_remaining then
          insert into cook_log_batch_usages (cook_log_id, ingredient_id, added_on, quantity) values (v_log, v_ing.id, b.added_on, b.quantity);
          v_remaining := v_remaining - b.quantity;
          delete from ingredient_batches where id = b.id;
        else
          insert into cook_log_batch_usages (cook_log_id, ingredient_id, added_on, quantity) values (v_log, v_ing.id, b.added_on, v_remaining);
          update ingredient_batches set quantity = b.quantity - v_remaining where id = b.id;
          v_remaining := 0;
        end if;
      end loop;
    end if;
  end loop;

  return v_log;
end;
$$;

-- ------------------------------------------------------------
-- 4. 取り消し(差し引いた量とロットを戻す)
-- ------------------------------------------------------------
-- 戻り値: true = 取り消した、false = すでに取り消し済み(何もしない)
create or replace function undo_cook(p_cook_log_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
  v_log cook_logs;
  it record;
  u record;
  v_batch uuid;
begin
  if auth.uid() is null or v_group is null then
    raise exception '権限がありません';
  end if;
  select * into v_log from cook_logs where id = p_cook_log_id and group_id = v_group for update;
  if not found then
    raise exception '権限がありません';
  end if;
  if v_log.undone_at is not null then
    return false;
  end if;

  for it in
    select ingredient_id, sum(used_quantity) as used
    from cook_log_items where cook_log_id = v_log.id and ingredient_id is not null
    group by ingredient_id order by ingredient_id
  loop
    -- 食材が冷蔵庫から削除されていたら戻せない(その食材だけ飛ばす)
    perform 1 from ingredients where id = it.ingredient_id and group_id = v_group for update;
    if found and it.used > 0 then
      update ingredients set quantity = quantity + it.used where id = it.ingredient_id;
      for u in select added_on, quantity from cook_log_batch_usages where cook_log_id = v_log.id and ingredient_id = it.ingredient_id loop
        select id into v_batch from ingredient_batches
        where ingredient_id = it.ingredient_id and added_on is not distinct from u.added_on
        order by created_at limit 1 for update;
        if v_batch is null then
          insert into ingredient_batches (ingredient_id, quantity, added_on) values (it.ingredient_id, u.quantity, u.added_on);
        else
          update ingredient_batches set quantity = quantity + u.quantity where id = v_batch;
        end if;
        v_batch := null;
      end loop;
    end if;
  end loop;

  update cook_logs set undone_at = now(), undone_by = auth.uid() where id = v_log.id;
  return true;
end;
$$;

revoke all on function cook_recipe_v2(uuid, jsonb, uuid) from public, anon;
revoke all on function undo_cook(uuid) from public, anon;
grant execute on function cook_recipe_v2(uuid, jsonb, uuid) to authenticated;
grant execute on function undo_cook(uuid) to authenticated;
