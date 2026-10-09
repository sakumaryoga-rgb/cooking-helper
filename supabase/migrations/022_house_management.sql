-- 022: 家の管理(管理者・メンバー、表示名、名前の変更、脱退、退出、管理者の譲渡、家の削除)
--
-- 何度実行しても同じ結果になる。既存の家・メンバー・冷蔵庫・レシピは削除・初期化しない。
-- 既存データへの変更は1つだけ: 管理者がいない家ごとに、最初に参加したメンバー(joined_at が最も古い人、同時なら user_id 順)を
-- 管理者にする(groups に作成者の記録がないため。create_group は作成者を最初のメンバーとして登録しているので、通常は作成者になる)。
--
-- 1. group_members に role(owner / member)と display_name(家ごとの任意の呼び名、20文字まで)を追加
-- 2. 家ごとに管理者はちょうど1人: 部分一意索引で2人目を拒否し、管理者の行が消えたとき(アカウント削除など)は
--    残っている最初のメンバーを管理者にする。管理者は脱退前に譲渡が必要(RPC で検証)
-- 3. 管理者のいない家に最初に入った人(= 家を作った人)を自動で管理者にする(create_group を変えずに済む)
-- 4. RPC: set_my_house_display_name / rename_group / leave_group / remove_group_member / transfer_group_owner / delete_group
--    すべて security definer、search_path 固定、authenticated のみ実行可。対象の家は引数で受け取り、
--    auth.uid() の所属と権限を DB で確かめる(選択中の家のヘッダーには依存しない)
-- 5. 退出させたときは、その家の有効な招待リンクを無効にする(古いリンクで戻れない)。自分で脱退した場合は無効にしない
-- 6. 家の削除は物理削除: groups の行を消し、外部キーの on delete cascade で、その家の食材・在庫ロット・レシピ・材料・
--    調理記録・招待・家庭専用の食材マスタ・別名・代替・使わない代替・メンバーを同じトランザクションで消す。
--    利用状況・エラー・お問い合わせの記録は group_id が null になるだけで残る。他の家の行には触れない。

-- ------------------------------------------------------------
-- 1. 列
-- ------------------------------------------------------------
alter table group_members add column if not exists role text not null default 'member';
alter table group_members add column if not exists display_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'group_members_role_check') then
    alter table group_members add constraint group_members_role_check check (role in ('owner', 'member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'group_members_display_name_check') then
    alter table group_members add constraint group_members_display_name_check
      check (display_name is null or char_length(display_name) between 1 and 20);
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. 既存の家に管理者を割り当てる(管理者がいない家だけ)
-- ------------------------------------------------------------
update group_members gm
set role = 'owner'
from (
  select distinct on (group_id) id
  from group_members
  where group_id not in (select group_id from group_members where role = 'owner')
  order by group_id, joined_at, user_id
) first_member
where gm.id = first_member.id;

create unique index if not exists group_members_one_owner_idx on group_members (group_id) where role = 'owner';

-- ------------------------------------------------------------
-- 3. 管理者の自動設定
-- ------------------------------------------------------------
-- 管理者のいない家に入った最初の人を管理者にする(家を作った人)
create or replace function group_members_default_owner()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from group_members where group_id = new.group_id and role = 'owner') then
    new.role := 'owner';
  else
    new.role := 'member';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_default_owner on group_members;
create trigger group_members_default_owner
  before insert on group_members
  for each row execute function group_members_default_owner();

-- 管理者の行が消えた(アカウント削除など、RPC を通らない場合)ら、残っている最初のメンバーを管理者にする
create or replace function group_members_keep_owner()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.role = 'owner'
     and exists (select 1 from groups where id = old.group_id)
     and not exists (select 1 from group_members where group_id = old.group_id and role = 'owner') then
    update group_members set role = 'owner'
    where id = (
      select id from group_members where group_id = old.group_id
      order by joined_at, user_id limit 1
    );
  end if;
  return null;
end;
$$;

drop trigger if exists group_members_keep_owner on group_members;
create trigger group_members_keep_owner
  after delete on group_members
  for each row execute function group_members_keep_owner();

revoke all on function group_members_default_owner() from public, anon, authenticated;
revoke all on function group_members_keep_owner() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. RPC
-- ------------------------------------------------------------
-- 呼び出した人のその家での役割(所属していなければ null)。行をロックして、同時の譲渡・退出と競合させない
create or replace function house_role_for_update(p_group_id uuid)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select role from group_members where group_id = p_group_id and user_id = auth.uid() for update;
$$;
revoke all on function house_role_for_update(uuid) from public, anon, authenticated;

-- 自分の呼び名(この家だけ)。空なら消す
create or replace function set_my_house_display_name(p_group_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null or house_role_for_update(p_group_id) is null then
    raise exception '権限がありません';
  end if;
  if v_name is not null and char_length(v_name) > 20 then
    raise exception '呼び名は20文字以内にしてください';
  end if;
  update group_members set display_name = v_name where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- 家の名前の変更(管理者のみ)
create or replace function rename_group(p_group_id uuid, p_name text)
returns groups
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_group groups;
begin
  if auth.uid() is null or house_role_for_update(p_group_id) is distinct from 'owner' then
    raise exception '家の管理者だけが変更できます';
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception '家の名前は1〜40文字にしてください';
  end if;
  update groups set name = v_name where id = p_group_id returning * into v_group;
  return v_group;
end;
$$;

-- 家から脱退する(自分だけ。アカウントと他の家はそのまま)
create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception '権限がありません';
  end if;
  v_role := house_role_for_update(p_group_id);
  if v_role is null then
    raise exception 'この家のメンバーではありません';
  end if;
  if v_role = 'owner' then
    if exists (select 1 from group_members where group_id = p_group_id and user_id <> auth.uid()) then
      raise exception '管理者は、先にほかのメンバーへ管理者を譲ってから脱退してください';
    end if;
    raise exception 'ほかにメンバーがいないため脱退できません。不要な場合は家を削除してください';
  end if;
  delete from group_members where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- メンバーを退出させる(管理者のみ。自分は対象外)。その家の有効な招待リンクも無効にする
create or replace function remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or house_role_for_update(p_group_id) is distinct from 'owner' then
    raise exception '家の管理者だけが操作できます';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception '自分自身は退出させられません。脱退する場合は「この家から脱退」を使ってください';
  end if;
  delete from group_members where group_id = p_group_id and user_id = p_user_id;
  if not found then
    raise exception 'このメンバーは家にいません';
  end if;
  update group_invites set revoked_at = now() where group_id = p_group_id and revoked_at is null;
end;
$$;

-- 管理者を譲る(管理者のみ。譲り先は同じ家のメンバー)。同じトランザクションで交代し、管理者は常に1人
create or replace function transfer_group_owner(p_group_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or house_role_for_update(p_group_id) is distinct from 'owner' then
    raise exception '家の管理者だけが操作できます';
  end if;
  if p_new_owner is null or p_new_owner = auth.uid() then
    raise exception 'ほかのメンバーを選んでください';
  end if;
  perform 1 from group_members where group_id = p_group_id and user_id = p_new_owner for update;
  if not found then
    raise exception 'このメンバーは家にいません';
  end if;
  update group_members set role = 'member' where group_id = p_group_id and user_id = auth.uid();
  update group_members set role = 'owner' where group_id = p_group_id and user_id = p_new_owner;
end;
$$;

-- 家を削除する(管理者のみ。確認のため家の名前を入力させる)。この家のデータだけを消す
create or replace function delete_group(p_group_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text;
begin
  if auth.uid() is null or house_role_for_update(p_group_id) is distinct from 'owner' then
    raise exception '家の管理者だけが削除できます';
  end if;
  select name into v_name from groups where id = p_group_id for update;
  if v_name is null or btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception '家の名前が一致しません';
  end if;
  delete from groups where id = p_group_id;
end;
$$;

revoke all on function set_my_house_display_name(uuid, text) from public, anon;
revoke all on function rename_group(uuid, text) from public, anon;
revoke all on function leave_group(uuid) from public, anon;
revoke all on function remove_group_member(uuid, uuid) from public, anon;
revoke all on function transfer_group_owner(uuid, uuid) from public, anon;
revoke all on function delete_group(uuid, text) from public, anon;
grant execute on function set_my_house_display_name(uuid, text) to authenticated;
grant execute on function rename_group(uuid, text) to authenticated;
grant execute on function leave_group(uuid) to authenticated;
grant execute on function remove_group_member(uuid, uuid) to authenticated;
grant execute on function transfer_group_owner(uuid, uuid) to authenticated;
grant execute on function delete_group(uuid, text) to authenticated;
