-- COOKDOOR v1.2.0: 招待を8文字の招待コードから、ランダムな招待トークンに切り替える
--
-- - 招待トークンは 32 バイトの乱数(URL に使える base64、43文字)。DB にはハッシュ(SHA-256)だけを保存する。
--   トークン本体は発行した直後に1回だけ返す。
-- - グループごとに有効なトークンは1つ。再発行すると前のトークンは無効になる。有効期限は7日。
-- - 参加の失敗(存在しない・期限切れ・無効化済み)は、ユーザーごとに1時間10回まで。
-- - 旧方式(groups.invite_code と join_group)は、この migration で利用を止める。
--   旧コードの値の削除は migration 011 で別に行う(ロールバックできる余地を残すため)。
-- - group_invites と invite_join_attempts はクライアントから直接読み書きできない。RPC だけで操作する。
--
-- 何度実行しても同じ結果になるように書いている。SQL Editor で全体をそのまま実行する。

-- ------------------------------------------------------------
-- 1. テーブル
-- ------------------------------------------------------------
create table if not exists group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint group_invites_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

-- グループごとに有効な(無効化されていない)招待は1つだけ
create unique index if not exists group_invites_one_active_idx
  on group_invites (group_id) where revoked_at is null;

create table if not exists invite_join_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists invite_join_attempts_user_created_idx on invite_join_attempts (user_id, created_at);

revoke all on table group_invites from anon, authenticated;
revoke all on table invite_join_attempts from anon, authenticated;
alter table group_invites enable row level security;
alter table invite_join_attempts enable row level security;
-- ポリシーは作らない(クライアントからは一切アクセスできない。RPC は security definer で操作する)

-- ------------------------------------------------------------
-- 2. ハッシュ
-- ------------------------------------------------------------
create or replace function invite_token_hash(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function invite_token_hash(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. 招待の発行(再発行)・現在の状態・無効化
-- ------------------------------------------------------------
create or replace function create_group_invite()
returns table (invite_token text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
  v_token text;
  v_expires timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null or v_group is null then
    raise exception '権限がありません';
  end if;

  -- 32バイトの乱数を URL に使える base64 にする(+ / = を使わない)
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  update group_invites set revoked_at = now() where group_id = v_group and revoked_at is null;
  insert into group_invites (group_id, token_hash, created_by, expires_at)
  values (v_group, invite_token_hash(v_token), auth.uid(), v_expires);

  return query select v_token, v_expires;
end;
$$;

create or replace function get_group_invite_status()
returns table (invite_active boolean, invite_expires_at timestamptz, invite_created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
begin
  if auth.uid() is null or v_group is null then
    raise exception '権限がありません';
  end if;
  return query
    select (gi.expires_at > now()), gi.expires_at, gi.created_at
    from group_invites gi
    where gi.group_id = v_group and gi.revoked_at is null;
end;
$$;

create or replace function revoke_group_invite()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
begin
  if auth.uid() is null or v_group is null then
    raise exception '権限がありません';
  end if;
  update group_invites set revoked_at = now() where group_id = v_group and revoked_at is null;
end;
$$;

-- ------------------------------------------------------------
-- 4. 招待トークンで参加する(レート制限つき)
--    参加できたらそのグループ、トークンが無効・期限切れなら null を返す
-- ------------------------------------------------------------
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
  if exists (select 1 from group_members where user_id = v_user) then
    raise exception 'すでにグループに所属しています';
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
    -- 例外を出すと失敗の記録も取り消されるため、記録して null を返す(画面側で案内を出す)
    insert into invite_join_attempts (user_id) values (v_user);
    delete from invite_join_attempts where created_at < now() - interval '1 day';
    return null;
  end if;

  insert into group_members (group_id, user_id) values (v_invite.group_id, v_user);
  select * into v_group from groups where id = v_invite.group_id;
  return v_group;
end;
$$;

revoke all on function create_group_invite() from public, anon;
revoke all on function get_group_invite_status() from public, anon;
revoke all on function revoke_group_invite() from public, anon;
revoke all on function join_group_with_invite(text) from public, anon;
grant execute on function create_group_invite() to authenticated;
grant execute on function get_group_invite_status() to authenticated;
grant execute on function revoke_group_invite() to authenticated;
grant execute on function join_group_with_invite(text) to authenticated;

-- ------------------------------------------------------------
-- 5. 旧方式の利用停止(値の削除は migration 011)
-- ------------------------------------------------------------
-- 旧 join_group は常に失敗させる。古い版のアプリから呼ばれても参加できない
create or replace function join_group(join_code text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception '招待コードは使えなくなりました。グループのメンバーに新しい招待リンクを発行してもらってください';
end;
$$;

-- groups.invite_code の読み取り権限はここでは外さない。旧版のアプリ(v1.1.x)はグループの取得時に
-- この列を読むため、外すとグループが見えなくなる。v1.2.0 は public/version.json の minSupportedVersion で
-- 旧版の更新を強制する。列の権限と値は migration 011 で外す。
