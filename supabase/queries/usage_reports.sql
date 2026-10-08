-- COOKDOOR 利用状況・エラーの集計(SQL Editor で、必要なものだけ選んで実行する。読み取りのみ)
-- 日付は日本時間で区切る。保存期間は 90 日なので、それより前は出てこない。
-- 個人を特定する列(user_id、group_id)は件数の集計にだけ使い、そのまま表示しない。

-- 1. 日別 PV(直近30日)
select (created_at at time zone 'Asia/Tokyo')::date as day, count(*) as page_views
from page_views
where created_at >= now() - interval '30 days'
group by day
order by day desc;

-- 2. 日別アクティブユーザー数・アクティブグループ数(直近30日)
select (created_at at time zone 'Asia/Tokyo')::date as day,
       count(distinct user_id) as active_users,
       count(distinct group_id) as active_groups
from page_views
where created_at >= now() - interval '30 days'
group by day
order by day desc;

-- 3. 画面別 PV(直近30日)
select path, count(*) as page_views, count(distinct user_id) as users
from page_views
where created_at >= now() - interval '30 days'
group by path
order by page_views desc;

-- 4. アプリのバージョン別の利用(直近7日)。古い版を使い続けている人数が分かる
select app_version,
       count(*) as page_views,
       count(distinct user_id) as users,
       max(created_at) at time zone 'Asia/Tokyo' as last_seen
from page_views
where created_at >= now() - interval '7 days'
group by app_version
order by app_version desc;

-- 5. エラー件数と発生画面(直近7日)。同じ指紋のエラーをまとめる
select fingerprint,
       kind,
       min(message) as message,
       count(*) as occurrences,
       count(distinct user_id) as users,
       string_agg(distinct path, ', ') as paths,
       string_agg(distinct app_version, ', ') as versions,
       max(created_at) at time zone 'Asia/Tokyo' as last_seen
from client_errors
where created_at >= now() - interval '7 days'
group by fingerprint, kind
order by occurrences desc
limit 50;

-- 6. 直近7日と直近30日の利用状況のまとめ
select period,
       count(*) as page_views,
       count(distinct user_id) as active_users,
       count(distinct group_id) as active_groups,
       count(distinct (created_at at time zone 'Asia/Tokyo')::date) as active_days
from (
  select created_at, user_id, group_id, '直近7日' as period from page_views where created_at >= now() - interval '7 days'
  union all
  select created_at, user_id, group_id, '直近30日' from page_views where created_at >= now() - interval '30 days'
) t
group by period
order by period;

-- 7. 直近7日と直近30日のエラー件数
select '直近7日' as period, count(*) as errors, count(distinct fingerprint) as distinct_errors, count(distinct user_id) as users
from client_errors where created_at >= now() - interval '7 days'
union all
select '直近30日', count(*), count(distinct fingerprint), count(distinct user_id)
from client_errors where created_at >= now() - interval '30 days';

-- 8. 保存期間の確認(最も古い行が 90 日以内であること)
select 'page_views' as table_name, min(created_at) at time zone 'Asia/Tokyo' as oldest, count(*) as total from page_views
union all
select 'client_errors', min(created_at) at time zone 'Asia/Tokyo', count(*) from client_errors;

-- 9. 90日を超えた行を手動で削除する(pg_cron がない場合、または今すぐ消したい場合)
-- select * from purge_usage_and_error_logs();
