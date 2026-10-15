-- 029: 食材マスタ・食材の別名・代替ルール・調理の記録の「読み取り」を、所属している家すべてに広げる
--
-- 何度実行しても同じ結果になる。データは変更・削除しない。書き込み(追加・変更・削除)の権限は変えない。
--
-- 背景: これらの読み取りは my_group_id()(アプリが送る「選んでいる家」のヘッダー)で判定していた(migration 013・014)。
-- リアルタイムの通知にはヘッダーが付かないため「最初に参加した家」とみなされ、複数の家に入っている人には、
-- 最初の家以外の家庭専用の品目(リストにない食材)の通知が届かなかった。
-- 冷蔵庫・レシピ・ロットなどは migration 021 で「読み取りは所属している家」「書き込みは選んでいる家」になっており、それに揃える。
--
-- 変更(読み取りだけ):
--   ingredient_catalog       共通(group_id なし) + 自分の家     → 共通 + 所属している家
--   ingredient_aliases       共通 + 自分の家                    → 共通 + 所属している家
--   ingredient_substitutions 共通 + 自分の家                    → 共通 + 所属している家
--   cook_logs                自分の家                            → 所属している家(共通の行はない)
--   cook_log_items           自分の家の記録の行                  → 所属している家の記録の行
-- 他人の家(所属していない家)は、これまでどおり読めない。
-- アプリは v1.33.0 から、選んでいる家と共通の行だけを使う(複数の家のデータを混ぜない)。
-- 古いアプリ(1.32 以前)は家で絞らないため、v1.33.0(最低対応バージョン 1.33.0)を公開してから適用する。
--
-- 負荷: is_group_member(group_id) は group_members(group_id, user_id) の一意インデックスを使う。
-- 共通の行(group_id なし)は is_group_member を呼ばずに読める(or の先に判定)。

drop policy if exists "read common and own catalog" on ingredient_catalog;
drop policy if exists "read common and member catalog" on ingredient_catalog;
create policy "read common and member catalog" on ingredient_catalog
  for select to authenticated
  using (group_id is null or is_group_member(group_id));

drop policy if exists "read common and own aliases" on ingredient_aliases;
drop policy if exists "read common and member aliases" on ingredient_aliases;
create policy "read common and member aliases" on ingredient_aliases
  for select to authenticated
  using (group_id is null or is_group_member(group_id));

drop policy if exists "read common and own substitutions" on ingredient_substitutions;
drop policy if exists "read common and member substitutions" on ingredient_substitutions;
create policy "read common and member substitutions" on ingredient_substitutions
  for select to authenticated
  using (group_id is null or is_group_member(group_id));

drop policy if exists "read own cook logs" on cook_logs;
drop policy if exists "read member cook logs" on cook_logs;
create policy "read member cook logs" on cook_logs
  for select to authenticated
  using (is_group_member(group_id));

drop policy if exists "read own cook log items" on cook_log_items;
drop policy if exists "read member cook log items" on cook_log_items;
create policy "read member cook log items" on cook_log_items
  for select to authenticated
  using (exists (select 1 from cook_logs l where l.id = cook_log_items.cook_log_id and is_group_member(l.group_id)));
