-- 026: 食材ごとの分量の換算マスタ(全体共通・読み取り専用)と、計量の単位の定義。
--
-- ・ingredient_unit_conversions(migration 024)は家庭ごとの確認済みの換算で、そのまま残す(こちらが優先)。
-- ・この表は公開資料の「目安」。食材マスタの共通品目(group_id が null)にだけ結び付け、家庭専用の品目には付けない。
-- ・状態(生・ゆで・殻付き・切り身など)を state_key で区別し、1束・1袋・1パックは品目ごとに持つ(単位だけの共通換算はしない)。
-- ・usage_policy: suggest_only(候補として見せるだけ)/ conditional(計量スプーン等。表示に「約」を付けて使う)/ allowed_auto(使わない予約)。
--   アプリは目安の値で在庫を自動で引かない(家庭で確認した値か、g⇔kg・大さじ⇔ml のような計量の定義だけを確定に使う)。
-- ・一般の利用者は読むだけ。追加・変更・削除はできない(運用者が migration で更新する)。
-- 何度実行しても同じ結果になる(if not exists、on conflict)。

-- ------------------------------------------------------------
-- 1. 計量の単位(同じ次元の中だけで厳密に換算できるもの)
-- ------------------------------------------------------------
create table if not exists measurement_units (
  unit text primary key check (char_length(unit) between 1 and 10),
  dimension text not null check (dimension in ('mass', 'volume')),
  -- 基準の単位(mass は g、volume は ml)でいくつか
  base_amount numeric not null check (base_amount > 0),
  note text
);

insert into measurement_units (unit, dimension, base_amount, note) values
  ('g', 'mass', 1, null),
  ('kg', 'mass', 1000, null),
  ('ml', 'volume', 1, null),
  ('cc', 'volume', 1, null),
  ('L', 'volume', 1000, null),
  ('小さじ', 'volume', 5, '計量スプーン小さじ1 = 5ml'),
  ('大さじ', 'volume', 15, '計量スプーン大さじ1 = 15ml'),
  ('カップ', 'volume', 200, '計量カップ1 = 200ml(米用カップではない)'),
  ('合', 'volume', 180, '米用カップ1合 = 180ml')
on conflict (unit) do update set dimension = excluded.dimension, base_amount = excluded.base_amount, note = excluded.note;

alter table measurement_units enable row level security;
drop policy if exists "read measurement units" on measurement_units;
create policy "read measurement units" on measurement_units for select to authenticated using (true);
revoke all on measurement_units from anon;
revoke insert, update, delete, truncate on measurement_units from authenticated;
grant select on measurement_units to authenticated;

-- ------------------------------------------------------------
-- 2. 食材ごとの換算の目安(全体共通)
-- ------------------------------------------------------------
create table if not exists ingredient_catalog_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references ingredient_catalog(id) on delete cascade,
  from_unit text not null check (char_length(from_unit) between 1 and 10),
  from_quantity numeric not null default 1 check (from_quantity > 0),
  to_unit text not null check (to_unit in ('g', 'ml')),
  to_quantity numeric not null check (to_quantity > 0),
  -- 資料に幅があるとき(30〜50g など)。to_quantity は表示用の中央の値で、真の値として扱わない
  min_quantity numeric check (min_quantity is null or min_quantity > 0),
  max_quantity numeric check (max_quantity is null or max_quantity > 0),
  state_key text not null default '一般' check (char_length(state_key) between 1 and 30),
  weight_basis text not null check (weight_basis in ('gross', 'edible', 'net', 'volume_measure', 'unspecified')),
  usage_policy text not null default 'suggest_only' check (usage_policy in ('suggest_only', 'conditional', 'allowed_auto')),
  source_id text not null check (char_length(source_id) between 1 and 40),
  source_url text not null check (source_url ~ '^https://'),
  source_note text check (source_note is null or char_length(source_note) <= 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (min_quantity is null or max_quantity is null or min_quantity <= max_quantity),
  unique (catalog_id, from_unit, state_key, source_id)
);
create index if not exists idx_catalog_unit_conversions_catalog on ingredient_catalog_unit_conversions (catalog_id) where is_active;

-- 共通の品目にだけ結び付ける(家庭専用の品目の名前や存在が、他の家に見えないように)
create or replace function check_catalog_conversion_common()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if exists (select 1 from ingredient_catalog where id = new.catalog_id and group_id is not null) then
    raise exception '共通の食材マスタの品目にだけ換算を登録できます';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_check_catalog_conversion_common on ingredient_catalog_unit_conversions;
create trigger trg_check_catalog_conversion_common
  before insert or update on ingredient_catalog_unit_conversions
  for each row execute function check_catalog_conversion_common();

alter table ingredient_catalog_unit_conversions enable row level security;
drop policy if exists "read active catalog conversions" on ingredient_catalog_unit_conversions;
create policy "read active catalog conversions" on ingredient_catalog_unit_conversions for select to authenticated using (is_active);
revoke all on ingredient_catalog_unit_conversions from anon;
revoke insert, update, delete, truncate on ingredient_catalog_unit_conversions from authenticated;
grant select on ingredient_catalog_unit_conversions to authenticated;

-- ------------------------------------------------------------
-- 3. 初期データ(出典つき。supabase/seed/unit_conversions.csv)
-- ------------------------------------------------------------
-- BEGIN SEED (scripts/build-unit-conversion-seed.mjs で supabase/seed/unit_conversions.csv から生成。153 行)
insert into ingredient_catalog_unit_conversions
  (catalog_id, from_unit, from_quantity, to_unit, to_quantity, min_quantity, max_quantity, state_key, weight_basis, usage_policy, source_id, source_url, source_note)
select c.id, v.from_unit, v.from_quantity, v.to_unit, v.to_quantity, v.min_quantity, v.max_quantity, v.state_key, v.weight_basis, v.usage_policy, v.source_id, v.source_url, v.source_note
from (values
  ('アスパラガス', '束', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('アスパラガス', '本', 1, 'g', 20, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('かぶ', '個', 1, 'g', 80, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('かぼちゃ', '個', 1, 'g', 1200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('カリフラワー', '個', 1, 'g', 500, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('キャベツ', '個', 1, 'g', 1200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('キャベツ', '枚', 1, 'g', 50, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('きゅうり', '本', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ゴーヤ', '本', 1, 'g', 250, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ごぼう', '本', 1, 'g', 150, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('小松菜', '束', 1, 'g', 300, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('さやいんげん', '本', 1, 'g', 7, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('春菊', '束', 1, 'g', 200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('しょうが', 'かけ', 1, 'g', 12, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ズッキーニ', '本', 1, 'g', 200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('セロリ', '本', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('大根', '本', 1, 'g', 1000, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('たけのこ', '個', 1, 'g', 200, null, null, '水煮', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('玉ねぎ', '個', 1, 'g', 200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('とうもろこし', '本', 1, 'g', 350, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('トマト', '個', 1, 'g', 200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ナス', '個', 1, 'g', 80, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ニラ', '束', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('にんじん', '本', 1, 'g', 150, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('にんにく', 'かけ', 1, 'g', 8, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('長ねぎ', '本', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('白菜', '株', 1, 'g', 2000, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('白菜', '枚', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('パプリカ', '個', 1, 'g', 150, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('万能ねぎ(小ねぎ)', '束', 1, 'g', 55, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('万能ねぎ(小ねぎ)', '本', 1, 'g', 7, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ピーマン', '個', 1, 'g', 35, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ブロッコリー', '個', 1, 'g', 200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ブロッコリー', '房', 1, 'g', 15, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('ほうれん草', '束', 1, 'g', 200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('水菜', '束', 1, 'g', 200, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('もやし', '袋', 1, 'g', 250, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '市販品の内容量は商品差がある'),
  ('レタス', '個', 1, 'g', 400, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('レタス', '枚', 1, 'g', 30, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('れんこん', '節', 1, 'g', 180, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '一般的な大きさの目安。可食部重量とは異なる'),
  ('さつまいも', '本', 1, 'g', 250, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('里いも', '個', 1, 'g', 50, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('じゃがいも', '個', 1, 'g', 150, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('長いも', '本', 1, 'g', 500, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('えのき', '袋', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', 'パック容量はメーカー・店で変動。1パックを一般規則にしない'),
  ('エリンギ', 'パック', 1, 'g', 90, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', 'パック容量はメーカー・店で変動。1パックを一般規則にしない'),
  ('エリンギ', '本', 1, 'g', 40, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('しめじ', 'パック', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', 'パック容量はメーカー・店で変動。1パックを一般規則にしない'),
  ('しいたけ', 'パック', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', 'パック容量はメーカー・店で変動。1パックを一般規則にしない'),
  ('しいたけ', '個', 1, 'g', 15, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('しいたけ', '枚', 1, 'g', 10, null, null, '軸なし', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('まいたけ', 'パック', 1, 'g', 100, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', 'パック容量はメーカー・店で変動。1パックを一般規則にしない'),
  ('マッシュルーム', 'パック', 1, 'g', 150, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', 'パック容量はメーカー・店で変動。1パックを一般規則にしない'),
  ('マッシュルーム', '個', 1, 'g', 10, null, null, '一般', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('厚揚げ', '枚', 1, 'g', 135, null, null, '一般', 'net', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '商品の表示内容量が分かる場合は商品表示を優先'),
  ('油揚げ', '枚', 1, 'g', 30, null, null, '一般', 'net', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '商品の表示内容量が分かる場合は商品表示を優先'),
  ('木綿豆腐', '丁', 1, 'g', 300, null, null, '一般', 'net', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '商品の表示内容量が分かる場合は商品表示を優先'),
  ('絹豆腐', '丁', 1, 'g', 300, null, null, '一般', 'net', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '商品の表示内容量が分かる場合は商品表示を優先'),
  ('納豆', 'パック', 1, 'g', 50, null, null, '一般', 'net', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '商品の表示内容量が分かる場合は商品表示を優先'),
  ('米', '合', 1, 'g', 150, null, null, '精白米・生', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '生米と炊飯後の重量を混同しない。合は180ml、一般カップは200ml'),
  ('米', 'カップ', 1, 'g', 170, null, null, '精白米・生', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '生米と炊飯後の重量を混同しない。合は180ml、一般カップは200ml'),
  ('米', '合', 1, 'g', 160, null, null, '無洗米・生', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '生米と炊飯後の重量を混同しない。合は180ml、一般カップは200ml'),
  ('米', 'カップ', 1, 'g', 180, null, null, '無洗米・生', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '生米と炊飯後の重量を混同しない。合は180ml、一般カップは200ml'),
  ('鶏もも肉', '枚', 1, 'g', 250, null, null, '一般', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('鶏むね肉', '枚', 1, 'g', 180, null, null, '一般', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('鶏ささみ', '本', 1, 'g', 40, null, null, '一般', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('ベーコン', '枚', 1, 'g', 20, null, null, '一般', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('ハム', '枚', 1, 'g', 15, null, null, 'ロースハム', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', null),
  ('アジ(丸)', '尾', 1, 'g', 150, null, null, '丸魚', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('イカ', '杯', 1, 'g', 300, null, null, '丸', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('イワシ(丸)', '尾', 1, 'g', 100, null, null, '丸魚', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('鮭(切り身)', '切れ', 1, 'g', 100, null, null, '切り身', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('サバ(切り身)', '切れ', 1, 'g', 80, null, null, '切り身', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('サンマ(丸)', '尾', 1, 'g', 150, null, null, '丸魚', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('タコ', '本', 1, 'g', 150, null, null, 'ゆで・足', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('タラ(切り身)', '切れ', 1, 'g', 100, null, null, '切り身', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('アサリ', '個', 1, 'g', 10, null, null, '殻つき', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('ホタテ', '個', 1, 'g', 60, null, null, '貝柱', 'gross', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '丸魚・殻つき・切り身の重量は同一ではない。可食部換算は別ソースが必要'),
  ('エビ', '尾', 1, 'g', 15, 10, 20, '小・むき身', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '原資料に幅があるため平均値を唯一の真値として扱わない'),
  ('エビ', '尾', 1, 'g', 40, 30, 50, '大・殻つき', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '原資料に幅があるため平均値を唯一の真値として扱わない'),
  ('そば(乾麺)', '人前', 1, 'g', 70, 60, 80, '乾めん', 'unspecified', 'suggest_only', 'AJI_FOOD', 'https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/', '原資料に幅があるため平均値を唯一の真値として扱わない'),
  ('料理酒', '小さじ', 1, 'g', 5, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('料理酒', '大さじ', 1, 'g', 15, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('酢', '小さじ', 1, 'g', 5, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('酢', '大さじ', 1, 'g', 15, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('醤油', '小さじ', 1, 'g', 6, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('醤油', '大さじ', 1, 'g', 18, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('みりん', '小さじ', 1, 'g', 6, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('みりん', '大さじ', 1, 'g', 18, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('味噌', '小さじ', 1, 'g', 6, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('味噌', '大さじ', 1, 'g', 18, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('砂糖', '小さじ', 1, 'g', 3, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('砂糖', '大さじ', 1, 'g', 9, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('はちみつ', '小さじ', 1, 'g', 7, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('はちみつ', '大さじ', 1, 'g', 21, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('牛乳', '小さじ', 1, 'g', 5, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('牛乳', '大さじ', 1, 'g', 15, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('生クリーム', '小さじ', 1, 'g', 5, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('生クリーム', '大さじ', 1, 'g', 15, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('バター', '小さじ', 1, 'g', 4, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('バター', '大さじ', 1, 'g', 12, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('粉チーズ', '小さじ', 1, 'g', 2, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('粉チーズ', '大さじ', 1, 'g', 6, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('小麦粉', '小さじ', 1, 'g', 3, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('小麦粉', '大さじ', 1, 'g', 9, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('片栗粉', '小さじ', 1, 'g', 3, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('片栗粉', '大さじ', 1, 'g', 9, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('パン粉', '小さじ', 1, 'g', 1, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('パン粉', '大さじ', 1, 'g', 3, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('白ごま', '小さじ', 1, 'g', 3, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('白ごま', '大さじ', 1, 'g', 9, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('すりごま', '小さじ', 1, 'g', 2.5, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('すりごま', '大さじ', 1, 'g', 7, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('ケチャップ', '小さじ', 1, 'g', 5, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('ケチャップ', '大さじ', 1, 'g', 15, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('中濃ソース', '小さじ', 1, 'g', 6, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('中濃ソース', '大さじ', 1, 'g', 18, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('こしょう', '小さじ', 1, 'g', 2, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('こしょう', '大さじ', 1, 'g', 6, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'mlとgは同一ではない。調味料の製品・密度・計量方法によって変動'),
  ('サラダ油', '小さじ', 1, 'g', 4, null, null, '一般', 'volume_measure', 'conditional', 'EATREAT_OIL', 'https://eat-treat.jp/columns/1291', '温度や商品による密度差がある。g=mlと扱わない'),
  ('サラダ油', '大さじ', 1, 'g', 12, null, null, '一般', 'volume_measure', 'conditional', 'EATREAT_OIL', 'https://eat-treat.jp/columns/1291', '温度や商品による密度差がある。g=mlと扱わない'),
  ('ごま油', '小さじ', 1, 'g', 4, null, null, '一般', 'volume_measure', 'conditional', 'EATREAT_OIL', 'https://eat-treat.jp/columns/1291', '温度や商品による密度差がある。g=mlと扱わない'),
  ('ごま油', '大さじ', 1, 'g', 12, null, null, '一般', 'volume_measure', 'conditional', 'EATREAT_OIL', 'https://eat-treat.jp/columns/1291', '温度や商品による密度差がある。g=mlと扱わない'),
  ('オリーブオイル', '小さじ', 1, 'g', 4, null, null, '一般', 'volume_measure', 'conditional', 'EATREAT_OIL', 'https://eat-treat.jp/columns/1291', '温度や商品による密度差がある。g=mlと扱わない'),
  ('オリーブオイル', '大さじ', 1, 'g', 12, null, null, '一般', 'volume_measure', 'conditional', 'EATREAT_OIL', 'https://eat-treat.jp/columns/1291', '温度や商品による密度差がある。g=mlと扱わない'),
  ('塩', '小さじ', 1, 'g', 6, null, null, '一般', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('塩', '大さじ', 1, 'g', 18, null, null, '一般', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('顆粒コンソメ', '小さじ', 1, 'g', 3, null, null, '一般', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('顆粒コンソメ', '大さじ', 1, 'g', 9, null, null, '一般', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('マヨネーズ', '小さじ', 1, 'g', 4, null, null, '一般', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('マヨネーズ', '大さじ', 1, 'g', 12, null, null, '一般', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('マヨネーズ', 'カップ', 1, 'g', 190, null, null, '一般', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('からし', '小さじ', 1, 'g', 6, null, null, '練りがらし', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('米', '合', 1, 'g', 150, null, null, '精白米・生', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('米', 'カップ', 1, 'g', 160, null, null, '精白米・生', 'volume_measure', 'conditional', 'HIROSHIMA_CITY', 'https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/007/300/122404.pdf', '広島市「調味料 計量カップ・計量スプーンの重量換算表」(参考: 厚生労働省 国民健康・栄養調査 食品番号表)。すり切りの目安'),
  ('醤油', 'カップ', 1, 'g', 230, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('みりん', 'カップ', 1, 'g', 230, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('砂糖', 'カップ', 1, 'g', 130, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('小麦粉', 'カップ', 1, 'g', 110, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('片栗粉', 'カップ', 1, 'g', 130, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('牛乳', 'カップ', 1, 'g', 210, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('バター', 'カップ', 1, 'g', 180, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('白ごま', 'カップ', 1, 'g', 120, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('すりごま', 'カップ', 1, 'g', 100, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('ケチャップ', 'カップ', 1, 'g', 230, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('中濃ソース', 'カップ', 1, 'g', 240, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('料理酒', 'カップ', 1, 'g', 200, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('酢', 'カップ', 1, 'g', 200, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('はちみつ', 'カップ', 1, 'g', 280, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('パン粉', 'カップ', 1, 'g', 40, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('生クリーム', 'カップ', 1, 'g', 200, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('粉チーズ', 'カップ', 1, 'g', 90, null, null, '一般', 'volume_measure', 'conditional', 'AJI_COND', 'https://park.ajinomoto.co.jp/contents/basic/chomiryo_bunryou/', 'カップ1(200ml)の目安。すり切り'),
  ('卵', '個', 1, 'g', 61, 58, 64, 'Mサイズ・殻付き', 'gross', 'suggest_only', 'MAFF_EGG', 'https://www.maff.go.jp/j/kokuji_tuti/kokuji/k0000481.html', '鶏卵の規格(農林水産省告示)のM: 58g以上64g未満。殻付きの重量で、中身の重さではない。サイズの指定がないときは確定しない')
) as v(catalog_name, from_unit, from_quantity, to_unit, to_quantity, min_quantity, max_quantity, state_key, weight_basis, usage_policy, source_id, source_url, source_note)
join ingredient_catalog c on c.name = v.catalog_name and c.group_id is null
on conflict (catalog_id, from_unit, state_key, source_id) do update set
  from_quantity = excluded.from_quantity,
  to_unit = excluded.to_unit,
  to_quantity = excluded.to_quantity,
  min_quantity = excluded.min_quantity,
  max_quantity = excluded.max_quantity,
  weight_basis = excluded.weight_basis,
  usage_policy = excluded.usage_policy,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  is_active = true;
-- END SEED
