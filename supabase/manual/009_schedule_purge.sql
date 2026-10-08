-- 90日削除の自動実行を登録する(migration 009 の適用後、pg_cron を有効にしてから SQL Editor で実行する)。
-- 事前に Supabase の Database → Extensions で pg_cron を有効にする。
-- 何度実行しても、登録は1つだけになる。

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron が有効になっていません。Database → Extensions で有効にしてから実行してください';
  end if;
  execute $sql$
    select cron.unschedule(jobid) from cron.job where jobname = 'purge-usage-and-error-logs'
  $sql$;
  execute $sql$
    select cron.schedule('purge-usage-and-error-logs', '30 3 * * *', 'select * from public.purge_usage_and_error_logs()')
  $sql$;
end $$;

-- 確認: 1行返れば登録済み
select jobname, schedule, command, active from cron.job where jobname = 'purge-usage-and-error-logs';
