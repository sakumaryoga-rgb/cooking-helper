-- migration 011(旧招待コードの値の削除)の適用前に実行する(読み取りのみ)。
-- 011 はデータを変更する(groups.invite_code をすべて null にする)。元に戻すにはバックアップが必要。
-- 家族の全端末が v1.2.0 以上になってから適用する。

-- 1. 直近7日に 1.2.0 より古い版の利用が残っていないこと(0行なら OK)
select app_version, count(distinct user_id) as users, max(created_at) at time zone 'Asia/Tokyo' as last_seen
from page_views
where created_at >= now() - interval '7 days'
  and string_to_array(app_version, '.')::int[] < array[1, 2, 0]
group by app_version;

-- 2. 消える値の件数(控えておく)
select count(*) as legacy_codes from groups where invite_code is not null;
