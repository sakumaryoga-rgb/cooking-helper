-- 料理ヘルパーアプリ: データベーススキーマ
-- Supabaseダッシュボード > SQL Editor に、このファイルの内容をそのまま貼り付けて実行してください。
-- (プロジェクト作成後、1回だけ実行すればOKです)

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. テーブル定義
-- ============================================================

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now()
);

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  unit text not null,
  quantity numeric not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  url text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  required_quantity numeric not null check (required_quantity > 0),
  unique (recipe_id, ingredient_id)
);

-- ============================================================
-- 2. 「自分の所属グループID」を取得するヘルパー関数
--    (RLSポリシーの中で再帰的にgroup_membersを参照しないよう、
--     SECURITY DEFINERでRLSをバイパスして取得する)
-- ============================================================

create or replace function my_group_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select group_id from group_members where user_id = auth.uid();
$$;

-- ============================================================
-- 3. Row Level Security (行レベルセキュリティ)
--    自分の所属グループのデータしか読み書きできないようにする
-- ============================================================

alter table groups enable row level security;
alter table group_members enable row level security;
alter table ingredients enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;

-- groups: 自分の所属グループのみ閲覧可(作成/参加はRPC経由のみ)
create policy "select own group" on groups
  for select using (id = my_group_id());

-- group_members: 自分の所属グループのメンバー一覧のみ閲覧可(参加/脱退はRPC経由のみ)
create policy "select own group members" on group_members
  for select using (group_id = my_group_id());

-- ingredients: 自分の所属グループの食材のみ読み書き可
create policy "manage own group ingredients" on ingredients
  for all
  using (group_id = my_group_id())
  with check (group_id = my_group_id());

-- recipes: 自分の所属グループのレシピのみ読み書き可
create policy "manage own group recipes" on recipes
  for all
  using (group_id = my_group_id())
  with check (group_id = my_group_id());

-- recipe_ingredients: 親レシピが自分の所属グループのものか経由でチェック
create policy "manage own group recipe_ingredients" on recipe_ingredients
  for all
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id and r.group_id = my_group_id()
    )
  )
  with check (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id and r.group_id = my_group_id()
    )
  );

-- ============================================================
-- 4. グループ作成・参加・調理(在庫減算) の RPC 関数
-- ============================================================

-- グループを新規作成し、自分をメンバーに追加する
create or replace function create_group(group_name text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  new_group groups;
  code text;
begin
  if exists (select 1 from group_members where user_id = auth.uid()) then
    raise exception 'すでにグループに所属しています';
  end if;

  code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into groups (name, invite_code) values (group_name, code)
  returning * into new_group;

  insert into group_members (group_id, user_id) values (new_group.id, auth.uid());

  return new_group;
end;
$$;

-- 招待コードで既存グループに参加する
create or replace function join_group(join_code text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group groups;
begin
  if exists (select 1 from group_members where user_id = auth.uid()) then
    raise exception 'すでにグループに所属しています';
  end if;

  select * into target_group from groups where invite_code = upper(join_code);

  if not found then
    raise exception '招待コードが見つかりません';
  end if;

  insert into group_members (group_id, user_id) values (target_group.id, auth.uid());

  return target_group;
end;
$$;

-- レシピを「作った」際に、使用した分だけ冷蔵庫の在庫をまとめて減算する
-- p_used: { "食材のUUID": 使用した数量, ... } という形のJSON。
--         指定がない食材はレシピの必要量をそのまま使用したものとみなす。
create or replace function cook_recipe(p_recipe_id uuid, p_used jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r recipe_ingredients%rowtype;
  used_qty numeric;
  caller_group uuid;
  recipe_group uuid;
begin
  caller_group := my_group_id();

  select group_id into recipe_group from recipes where id = p_recipe_id;

  if recipe_group is null or recipe_group <> caller_group then
    raise exception '権限がありません';
  end if;

  for r in select * from recipe_ingredients where recipe_id = p_recipe_id loop
    used_qty := coalesce((p_used ->> r.ingredient_id::text)::numeric, r.required_quantity);
    update ingredients
      set quantity = greatest(quantity - used_qty, 0)
      where id = r.ingredient_id and group_id = caller_group;
  end loop;
end;
$$;

grant execute on function create_group(text) to authenticated;
grant execute on function join_group(text) to authenticated;
grant execute on function cook_recipe(uuid, jsonb) to authenticated;

-- ============================================================
-- 5. Realtime を有効化(冷蔵庫・レシピの変更を他メンバーに配信)
-- ============================================================

alter publication supabase_realtime add table ingredients;
alter publication supabase_realtime add table recipes;
alter publication supabase_realtime add table recipe_ingredients;
