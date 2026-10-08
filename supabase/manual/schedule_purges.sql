-- 90日削除の自動実行をまとめて登録する(pg_cron を有効にした後に SQL Editor で1回実行する。何度実行しても同じ)。
-- 事前に Supabase の Database → Extensions で pg_cron を有効にする。削除そのものは既存の関数が行う:
--   purge_usage_and_error_logs()(migration 009)… 画面の利用記録・エラーの記録
--   purge_contact_emails()(migration 016)   … お問い合わせの返信先メールアドレス
-- この SQL は予約を登録するだけで、実行した時点ではデータを削除しない(最初の削除は次の予定時刻)。

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron が有効になっていません。Database → Extensions で有効にしてから実行してください';
  end if;
  execute $sql$ select cron.unschedule(jobid) from cron.job where jobname in ('purge-usage-and-error-logs', 'purge-contact-emails') $sql$;
  execute $sql$ select cron.schedule('purge-usage-and-error-logs', '30 3 * * *', 'select * from public.purge_usage_and_error_logs()') $sql$;
  execute $sql$ select cron.schedule('purge-contact-emails', '45 3 * * *', 'select public.purge_contact_emails()') $sql$;
end $$;

-- 確認: 2行返れば登録済み(管理画面の「保存期間(90日)」でも「自動削除 あり」と出る)
select jobname, schedule, active from cron.job where jobname in ('purge-usage-and-error-logs', 'purge-contact-emails');
