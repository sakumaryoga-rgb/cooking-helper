-- COOKDOOR: 旧方式の招待コードの値を削除する(migration 010 と v1.2.0 の本番リリースの後に、別に実行する)
--
-- 前提: 010 を適用済みで、v1.2.0 が本番にあり、旧版(v1.1.x 以下)は minSupportedVersion で更新済み。
-- groups.invite_code の列自体は残す(列の削除は一般公開前の Phase 7 で行う)。
-- 何度実行しても同じ結果になる。

alter table groups alter column invite_code drop not null;

-- 新しいグループには旧コードを作らない
create or replace function create_group(group_name text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  new_group groups;
begin
  if exists (select 1 from group_members where user_id = auth.uid()) then
    raise exception 'すでにグループに所属しています';
  end if;

  insert into groups (name) values (group_name)
  returning * into new_group;

  insert into group_members (group_id, user_id) values (new_group.id, auth.uid());

  return new_group;
end;
$$;

update groups set invite_code = null where invite_code is not null;

-- クライアントから旧コードの列を読めないようにする
revoke select on table groups from anon, authenticated;
grant select (id, name, created_at) on table groups to authenticated;
