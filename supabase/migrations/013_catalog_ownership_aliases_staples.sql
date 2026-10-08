-- COOKDOOR v1.4.0(Phase 3): 食材マスタの権限、別名辞書、常備品
--
-- 1. 食材マスタ(ingredient_catalog)を「共通」(group_id が null)と「家庭専用」(group_id が自分のグループ)に分ける。
--    - 共通の品目は、クライアントから追加・変更・削除できない(これまでは誰でも削除できた)。
--    - 家庭専用の品目は、その家庭のメンバーだけが見られ、追加・変更・削除できる。
--    - 既存の行はすべて共通のまま残す(作成した家庭を記録していないため、家庭専用に振り分けられない)。
-- 2. 別名辞書(ingredient_aliases): 「人参」→「にんじん」のような表記の違いを、食材マスタの1品目にまとめる。
--    共通の別名(運営者が登録)と、家庭専用の別名がある。
-- 3. 常備品(ingredients.is_staple): 塩・しょうゆなど、在庫の数量を管理せずに「ある」とみなす食材の印。家庭ごと。
--
-- 何度実行しても同じ結果になるように書いている。SQL Editor で全体をそのまま実行する。

-- ------------------------------------------------------------
-- 1. 食材マスタの所有と権限
-- ------------------------------------------------------------
alter table ingredient_catalog add column if not exists group_id uuid references groups(id) on delete cascade;

-- 名前の一意性: 共通の中で一意、家庭専用は家庭の中で一意
alter table ingredient_catalog drop constraint if exists ingredient_catalog_name_key;
create unique index if not exists ingredient_catalog_common_name_idx on ingredient_catalog (name) where group_id is null;
create unique index if not exists ingredient_catalog_group_name_idx on ingredient_catalog (group_id, name) where group_id is not null;

alter table ingredient_catalog drop constraint if exists ingredient_catalog_name_length;
alter table ingredient_catalog add constraint ingredient_catalog_name_length check (char_length(name) between 1 and 40) not valid;

drop policy if exists "authenticated users can read ingredient catalog" on ingredient_catalog;
drop policy if exists "authenticated users can add to ingredient catalog" on ingredient_catalog;
drop policy if exists "authenticated users can delete from ingredient catalog" on ingredient_catalog;
drop policy if exists "read common and own catalog" on ingredient_catalog;
drop policy if exists "insert own catalog" on ingredient_catalog;
drop policy if exists "update own catalog" on ingredient_catalog;
drop policy if exists "delete own catalog" on ingredient_catalog;

create policy "read common and own catalog" on ingredient_catalog
  for select to authenticated
  using (group_id is null or group_id = my_group_id());
create policy "insert own catalog" on ingredient_catalog
  for insert to authenticated
  with check (group_id is not null and group_id = my_group_id());
create policy "update own catalog" on ingredient_catalog
  for update to authenticated
  using (group_id is not null and group_id = my_group_id())
  with check (group_id is not null and group_id = my_group_id());
create policy "delete own catalog" on ingredient_catalog
  for delete to authenticated
  using (group_id is not null and group_id = my_group_id());

revoke all on table ingredient_catalog from anon;

-- ------------------------------------------------------------
-- 2. 別名辞書
-- ------------------------------------------------------------
create table if not exists ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references ingredient_catalog(id) on delete cascade,
  alias text not null,
  group_id uuid references groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint ingredient_aliases_alias_length check (char_length(alias) between 1 and 40)
);
create unique index if not exists ingredient_aliases_common_idx on ingredient_aliases (alias) where group_id is null;
create unique index if not exists ingredient_aliases_group_idx on ingredient_aliases (group_id, alias) where group_id is not null;
create index if not exists ingredient_aliases_catalog_idx on ingredient_aliases (catalog_id);

alter table ingredient_aliases enable row level security;
revoke all on table ingredient_aliases from anon;

drop policy if exists "read common and own aliases" on ingredient_aliases;
drop policy if exists "insert own aliases" on ingredient_aliases;
drop policy if exists "delete own aliases" on ingredient_aliases;
create policy "read common and own aliases" on ingredient_aliases
  for select to authenticated
  using (group_id is null or group_id = my_group_id());
-- 家庭の別名は、共通の品目か自分の家庭の品目にだけ付けられる
create policy "insert own aliases" on ingredient_aliases
  for insert to authenticated
  with check (
    group_id is not null and group_id = my_group_id()
    and exists (
      select 1 from ingredient_catalog c
      where c.id = catalog_id and (c.group_id is null or c.group_id = my_group_id())
    )
  );
create policy "delete own aliases" on ingredient_aliases
  for delete to authenticated
  using (group_id is not null and group_id = my_group_id());

-- 共通の別名(初期データ)。食材マスタの共通の品目にだけ付ける。何度実行しても重複しない
insert into ingredient_aliases (catalog_id, alias)
select c.id, a.alias
from (values
  ('にんじん', '人参'), ('にんじん', 'ニンジン'),
  ('玉ねぎ', 'たまねぎ'), ('玉ねぎ', 'タマネギ'), ('玉ねぎ', '玉葱'), ('玉ねぎ', '新玉ねぎ'),
  ('じゃがいも', 'ジャガイモ'), ('じゃがいも', 'じゃが芋'), ('じゃがいも', '馬鈴薯'),
  ('さつまいも', 'サツマイモ'), ('さつまいも', 'さつま芋'),
  ('里いも', '里芋'), ('里いも', 'さといも'), ('長いも', '長芋'), ('長いも', '山芋'),
  ('長ねぎ', '長ネギ'), ('長ねぎ', 'ねぎ'), ('長ねぎ', '白ねぎ'), ('長ねぎ', '葱'),
  ('万能ねぎ(小ねぎ)', '小ねぎ'), ('万能ねぎ(小ねぎ)', '万能ねぎ'), ('万能ねぎ(小ねぎ)', '青ねぎ'), ('万能ねぎ(小ねぎ)', '細ねぎ'),
  ('にんにく', 'ニンニク'), ('にんにく', '大蒜'), ('しょうが', '生姜'), ('しょうが', 'ショウガ'),
  ('大根', 'だいこん'), ('かぶ', '蕪'), ('かぶ', 'カブ'), ('ごぼう', '牛蒡'), ('れんこん', '蓮根'),
  ('ナス', 'なす'), ('ナス', '茄子'), ('きゅうり', '胡瓜'), ('きゅうり', 'キュウリ'),
  ('かぼちゃ', '南瓜'), ('かぼちゃ', 'カボチャ'), ('キャベツ', 'きゃべつ'), ('白菜', 'はくさい'),
  ('ほうれん草', 'ほうれんそう'), ('ニラ', 'にら'), ('もやし', 'モヤシ'), ('大葉(しそ)', '大葉'), ('大葉(しそ)', 'しそ'), ('大葉(しそ)', '青じそ'),
  ('しいたけ', '椎茸'), ('しいたけ', 'シイタケ'), ('しめじ', 'シメジ'), ('えのき', 'えのき茸'), ('えのき', 'えのきだけ'), ('まいたけ', '舞茸'),
  ('トマト', 'とまと'), ('ピーマン', 'ぴーまん'),
  ('卵', 'たまご'), ('卵', '玉子'), ('卵', '鶏卵'), ('卵', 'タマゴ'),
  ('木綿豆腐', 'もめん豆腐'), ('絹豆腐', '絹ごし豆腐'), ('油揚げ', '油あげ'),
  ('醤油', 'しょうゆ'), ('醤油', 'しょう油'), ('醤油', '濃口しょうゆ'), ('味噌', 'みそ'),
  ('料理酒', '酒'), ('料理酒', '日本酒'), ('砂糖', '上白糖'), ('こしょう', '胡椒'), ('こしょう', 'コショウ'),
  ('サラダ油', '油'), ('ケチャップ', 'トマトケチャップ'), ('顆粒コンソメ', 'コンソメ'), ('鶏がらスープの素', '鶏ガラスープの素'),
  ('白ごま', 'いりごま'), ('削り節(かつお節)', 'かつお節'), ('削り節(かつお節)', 'かつおぶし'),
  ('スパゲッティ', 'スパゲティ'), ('スパゲッティ', 'パスタ'), ('中華麺', '中華めん'), ('片栗粉', 'かたくり粉'), ('小麦粉', '薄力粉'),
  ('豚こま切れ肉', '豚こま肉'), ('豚こま切れ肉', '豚小間切れ肉'), ('牛こま切れ肉', '牛こま肉'), ('合いびき肉', '合挽き肉'), ('合いびき肉', '合い挽き肉'),
  ('鶏もも肉', '鶏モモ肉'), ('鶏むね肉', '鶏ムネ肉'), ('鶏むね肉', '鶏胸肉'), ('鶏ひき肉', '鶏挽き肉'), ('豚ひき肉', '豚挽き肉'), ('牛ひき肉', '牛挽き肉'),
  ('鮭(切り身)', '鮭'), ('鮭(切り身)', 'さけ'), ('鮭(切り身)', '生鮭'), ('サバ(切り身)', 'さば'), ('ブリ(切り身)', 'ぶり'), ('タラ(切り身)', 'たら'),
  ('エビ', 'えび'), ('エビ', '海老'), ('イカ', 'いか'), ('ウインナー', 'ウィンナー'), ('ウインナー', 'ウインナーソーセージ'),
  ('ピザ用チーズ', 'とろけるチーズ'), ('バター', '有塩バター')
) as a(catalog_name, alias)
join ingredient_catalog c on c.name = a.catalog_name and c.group_id is null
where not exists (select 1 from ingredient_aliases x where x.alias = a.alias and x.group_id is null);

-- ------------------------------------------------------------
-- 3. 常備品
-- ------------------------------------------------------------
alter table ingredients add column if not exists is_staple boolean not null default false;
