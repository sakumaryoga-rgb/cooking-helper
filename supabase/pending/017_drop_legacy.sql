-- COOKDOOR: 旧機能の削除(まだ適用しない。docs/legacy-removal.md の前提がすべて揃ってから、承認を得て
-- supabase/migrations/ に移して番号を確定し、SQL Editor で実行する)
--
-- 削除するもの
--   - join_group(text): 旧方式の招待コードでの参加(migration 010 で停止済み)
--   - cook_recipe(uuid, jsonb): 旧「作った」(v1.5.0 以降は cook_recipe_v2)
--   - adjust_ingredient_quantity(uuid, numeric, boolean): 旧数量変更(v1.8.0 以降は adjust_stock)
--   - groups.invite_code 列(migration 011 で値を null にした後)
-- **データの削除を伴う**(invite_code 列)。元に戻すにはバックアップが必要。

drop function if exists join_group(text);
drop function if exists cook_recipe(uuid, jsonb);
drop function if exists adjust_ingredient_quantity(uuid, numeric, boolean);

-- 旧コードの値が残っている場合(011 が未適用)は中止する
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'invite_code') then
    if exists (select 1 from groups where invite_code is not null) then
      raise exception '旧招待コードの値が残っています。先に migration 011 を適用してください';
    end if;
    alter table groups drop column invite_code;
  end if;
end $$;
