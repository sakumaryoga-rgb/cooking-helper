-- お料理ヘルパーアプリ: 手動追加した食材もカテゴリ付きでマスタ(ingredient_catalog)に
-- 登録できるようにする(これまでは読み取り専用で、追加はSQL Editorからのみだった)。
-- Supabaseダッシュボード > SQL Editor に、このファイルの内容をそのまま貼り付けて実行してください。

create policy "authenticated users can add to ingredient catalog" on ingredient_catalog
  for insert
  to authenticated
  with check (true);
