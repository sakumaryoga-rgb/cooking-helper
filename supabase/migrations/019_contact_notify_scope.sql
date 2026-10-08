-- COOKDOOR v1.9.2: お問い合わせ通知の起動を、正当な呼び出しに限る
--
-- 一般の利用者が通知を起動できるのは、本人がいま送ったお問い合わせ(10分以内・未通知)の通知だけにする。
-- 通知 API(Vercel Function)が Supabase Auth で本人を確かめ、その利用者 ID を渡してこの関数を呼ぶ(service_role 専用)。
-- 未通知の全件を取り出す claim_contact_notifications は、運営者からの呼び出しにだけ使う。
-- 本文と返信先は返さない(通知には受付番号・種類・受付日時だけを送る)。
--
-- 既存のデータは変更しない(関数の追加だけ)。何度実行しても同じ結果になる。

create or replace function claim_own_contact_notifications(p_user_id uuid)
returns table (contact_id uuid, contact_created_at timestamptz, contact_category text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_user_id is null then
    return;
  end if;
  return query
  with picked as (
    select m.id from contact_messages m
    where m.user_id = p_user_id
      and m.created_at > now() - interval '10 minutes'
      and m.notified_at is null
      and m.notify_attempts < 5
      and (m.notify_claimed_at is null or m.notify_claimed_at < now() - interval '10 minutes')
    order by m.created_at
    limit 3
    for update skip locked
  )
  update contact_messages m
  set notify_claimed_at = now(), notify_attempts = m.notify_attempts + 1
  from picked
  where m.id = picked.id
  returning m.id, m.created_at, m.category;
end;
$$;

revoke all on function claim_own_contact_notifications(uuid) from public, anon, authenticated;
grant execute on function claim_own_contact_notifications(uuid) to service_role;
