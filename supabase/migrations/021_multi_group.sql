-- COOKDOOR v1.11.0: 1つのアカウントで複数の家(グループ)に参加し、切り替えて使う
--
-- 1. group_members の「1人1グループ」(user_id の一意制約)をやめ、(group_id, user_id) を一意にする。既存の所属はそのまま。
-- 2. 選択中の家: アプリは選択中のグループ ID を、すべての DB 呼び出しのヘッダー x-cookdoor-group で送る。
--    my_group_id() はそのグループに本人が所属しているかを DB 側で確かめてから返す(所属していなければ null)。
--    ヘッダーがない呼び出し(旧版のアプリ、リアルタイム配信)では、最初に参加した家を返す(これまでどおり)。
--    → 既存の RLS と RPC(在庫・調理・取り消し・招待・別名・代替・計測)は、選択中の家に限定されたまま動く。
-- 3. 読み取りの RLS を「所属しているすべての家」に広げる(groups、group_members、食材・ロット・レシピ・材料)。
--    リアルタイム配信はヘッダーを送れないため。書き込み(追加・変更・削除)は選択中の家だけのまま。
-- 4. 家を作る・招待で参加する RPC から「すでにグループに所属しています」の制限を外す。
--    すでに参加している家の招待リンクを開いた場合は、その家を返す(切り替えに使う)。
--
-- 既存のデータ(家・メンバー・在庫・レシピ・調理の記録)は変更しない。何度実行しても同じ結果になる。
-- migration 011 / 保留中の 017 とは独立している(旧招待コードの列の状態に合わせて動く)。

-- ------------------------------------------------------------
-- 1. 複数の家への所属
-- ------------------------------------------------------------
alter table group_members drop constraint if exists group_members_user_id_key;
create unique index if not exists group_members_group_user_idx on group_members (group_id, user_id);
create index if not exists group_members_user_idx on group_members (user_id, joined_at);

-- ------------------------------------------------------------
-- 2. 所属の確認と、選択中の家
-- ------------------------------------------------------------
create or replace function is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid());
$$;
grant execute on function is_group_member(uuid) to authenticated;

create or replace function my_group_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_header text;
  v_group uuid;
begin
  begin
    v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-cookdoor-group';
  exception when others then
    v_header := null;
  end;
  if v_header is not null then
    -- アプリが選んだ家。本人が所属していなければ、どの家としても扱わない(他の家のデータに届かない)
    if v_header !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return null;
    end if;
    select group_id into v_group from group_members where user_id = auth.uid() and group_id = v_header::uuid;
    return v_group;
  end if;
  -- ヘッダーがない呼び出し: 最初に参加した家(1つだけ所属している人は、これまでと同じ)
  select group_id into v_group from group_members where user_id = auth.uid() order by joined_at, group_id limit 1;
  return v_group;
end;
$$;

-- ------------------------------------------------------------
-- 3. RLS: 読み取りは所属しているすべての家、書き込みは選択中の家
-- ------------------------------------------------------------
drop policy if exists "select own group" on groups;
drop policy if exists "select member groups" on groups;
create policy "select member groups" on groups for select using (is_group_member(id));

drop policy if exists "select own group members" on group_members;
drop policy if exists "select member group members" on group_members;
create policy "select member group members" on group_members for select using (is_group_member(group_id));

drop policy if exists "manage own group ingredients" on ingredients;
drop policy if exists "read member ingredients" on ingredients;
drop policy if exists "write active group ingredients" on ingredients;
create policy "read member ingredients" on ingredients for select using (is_group_member(group_id));
create policy "write active group ingredients" on ingredients for all
  using (group_id = my_group_id()) with check (group_id = my_group_id());

drop policy if exists "manage own group recipes" on recipes;
drop policy if exists "read member recipes" on recipes;
drop policy if exists "write active group recipes" on recipes;
create policy "read member recipes" on recipes for select using (is_group_member(group_id));
create policy "write active group recipes" on recipes for all
  using (group_id = my_group_id()) with check (group_id = my_group_id());

drop policy if exists "manage own group recipe_ingredients" on recipe_ingredients;
drop policy if exists "read member recipe_ingredients" on recipe_ingredients;
drop policy if exists "write active group recipe_ingredients" on recipe_ingredients;
create policy "read member recipe_ingredients" on recipe_ingredients for select
  using (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and is_group_member(r.group_id)));
create policy "write active group recipe_ingredients" on recipe_ingredients for all
  using (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and r.group_id = my_group_id()))
  with check (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and r.group_id = my_group_id()));

drop policy if exists "manage own group ingredient batches" on ingredient_batches;
drop policy if exists "read member ingredient batches" on ingredient_batches;
drop policy if exists "write active group ingredient batches" on ingredient_batches;
create policy "read member ingredient batches" on ingredient_batches for select
  using (exists (select 1 from ingredients i where i.id = ingredient_batches.ingredient_id and is_group_member(i.group_id)));
create policy "write active group ingredient batches" on ingredient_batches for all
  using (exists (select 1 from ingredients i where i.id = ingredient_batches.ingredient_id and i.group_id = my_group_id()))
  with check (exists (select 1 from ingredients i where i.id = ingredient_batches.ingredient_id and i.group_id = my_group_id()));

-- ------------------------------------------------------------
-- 4. 家を作る・招待で参加する
-- ------------------------------------------------------------
create or replace function create_group(group_name text)
returns groups
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_group groups;
  v_code_required boolean;
begin
  if auth.uid() is null then
    raise exception '権限がありません';
  end if;
  if char_length(btrim(coalesce(group_name, ''))) not between 1 and 40 then
    raise exception 'グループ名は1〜40文字で入力してください';
  end if;
  -- 旧招待コードの列が必須のままなら(migration 011 の適用前)、使われない値を入れる
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'groups' and column_name = 'invite_code' and is_nullable = 'NO'
  ) into v_code_required;
  if v_code_required then
    execute 'insert into groups (name, invite_code) values ($1, $2) returning *'
      into new_group using btrim(group_name), upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  else
    insert into groups (name) values (btrim(group_name)) returning * into new_group;
  end if;
  insert into group_members (group_id, user_id) values (new_group.id, auth.uid());
  return new_group;
end;
$$;

-- 参加できたら(またはすでに参加していたら)その家、トークンが無効・期限切れなら null
create or replace function join_group_with_invite(p_token text)
returns groups
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_invite group_invites;
  v_group groups;
  v_failures int;
begin
  if v_user is null then
    raise exception '権限がありません';
  end if;

  select count(*) into v_failures
  from invite_join_attempts
  where user_id = v_user and created_at > now() - interval '1 hour';
  if v_failures >= 10 then
    raise exception '招待リンクの確認に失敗した回数が多すぎます。1時間ほどしてからもう一度お試しください';
  end if;

  select * into v_invite
  from group_invites
  where token_hash = invite_token_hash(coalesce(p_token, ''))
    and revoked_at is null
    and expires_at > now();

  if not found then
    insert into invite_join_attempts (user_id) values (v_user);
    delete from invite_join_attempts where created_at < now() - interval '1 day';
    return null;
  end if;

  insert into group_members (group_id, user_id) values (v_invite.group_id, v_user)
  on conflict (group_id, user_id) do nothing;
  select * into v_group from groups where id = v_invite.group_id;
  return v_group;
end;
$$;
