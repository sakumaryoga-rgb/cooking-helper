-- COOKDOOR v1.3.0: レシピURLからの取り込み
--
-- - recipes に、取り込み元の識別子(source_key、例: "kurashiru:<id>")、サイト名、人数を追加する。
--   同じグループで同じレシピを二重に取り込まないよう、(group_id, source_key) を一意にする。
--   既存のレシピは source_key が null のまま(手動登録と同じ扱い)。
-- - recipe_ingredients に、取り込んだ材料の元の行(raw_text、例: "鶏むね肉 1枚(250g)")を追加する。
-- - 調理手順・画像は保存しない。
-- - 既存の RLS(自分のグループの recipes / recipe_ingredients だけを操作できる)をそのまま使う。
--
-- 何度実行しても同じ結果になるように書いている。SQL Editor で全体をそのまま実行する。

alter table recipes add column if not exists source_key text;
alter table recipes add column if not exists source_site text;
alter table recipes add column if not exists servings int;
alter table recipe_ingredients add column if not exists raw_text text;

alter table recipes drop constraint if exists recipes_source_key_format;
alter table recipes add constraint recipes_source_key_format
  check (source_key is null or source_key ~ '^[a-z]+:[0-9a-z/-]{1,80}$');
alter table recipes drop constraint if exists recipes_source_site_length;
alter table recipes add constraint recipes_source_site_length
  check (source_site is null or char_length(source_site) <= 40);
alter table recipes drop constraint if exists recipes_servings_range;
alter table recipes add constraint recipes_servings_range
  check (servings is null or servings between 1 and 100);
alter table recipes drop constraint if exists recipes_title_length;
alter table recipes add constraint recipes_title_length
  check (char_length(title) between 1 and 200) not valid;
alter table recipe_ingredients drop constraint if exists recipe_ingredients_raw_text_length;
alter table recipe_ingredients add constraint recipe_ingredients_raw_text_length
  check (raw_text is null or char_length(raw_text) <= 200);

create unique index if not exists recipes_group_source_key_idx
  on recipes (group_id, source_key) where source_key is not null;

-- ------------------------------------------------------------
-- 冷蔵庫で食材を削除しても、レシピの材料を消さない
-- ------------------------------------------------------------
-- recipe_ingredients.ingredient_id は ingredients への on delete cascade のため、冷蔵庫の行を消すと
-- レシピからもその材料が消えていた。レシピが参照している食材は行を残して在庫を0にし、
-- 参照がなければ従来どおり行ごと削除する(adjust_ingredient_quantity の在庫0時と同じ扱い)。
-- 戻り値: true = 行を削除した、false = 在庫0にして残した
create or replace function remove_ingredient(p_ingredient_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group uuid := my_group_id();
begin
  if auth.uid() is null or v_group is null
     or not exists (select 1 from ingredients where id = p_ingredient_id and group_id = v_group) then
    raise exception '権限がありません';
  end if;

  if exists (select 1 from recipe_ingredients where ingredient_id = p_ingredient_id) then
    delete from ingredient_batches where ingredient_id = p_ingredient_id;
    update ingredients set quantity = 0 where id = p_ingredient_id and group_id = v_group;
    return false;
  end if;

  delete from ingredients where id = p_ingredient_id and group_id = v_group;
  return true;
end;
$$;

revoke all on function remove_ingredient(uuid) from public, anon;
grant execute on function remove_ingredient(uuid) to authenticated;
