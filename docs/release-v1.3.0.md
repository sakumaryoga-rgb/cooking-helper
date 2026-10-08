# v1.3.0 リリース手順(レシピURL取り込み)

承認後に行う。v1.2.0 を先にリリースしておく(このブランチは v1.2.0 の上にある)。

## 変更

- レシピ追加画面で、クラシル・DELISH KITCHEN・Nadia のレシピURLを貼って「読み込む」と、
  料理名・人数・材料を取り込む。材料は冷蔵庫の食材 → 食材マスタの順に名前で突き合わせ、
  保存先の単位に直した必要量を入れる(かっこ内の g、大さじ・小さじ・カップの ml)。
- 直せなかった分量や、名前の一部だけが一致したものは「分量を確かめてください」と出す。
  水・お湯・ゆで汁、適量・少々は最初は保存しない(チェックすれば保存できる)。
- 同じグループに同じレシピがあれば、読み込む前に知らせる(DB でも一意)。
- 対応外のサイトや読み込みの失敗時は、URLを残したまま手動で材料を追加できる。
- 保存するのは料理名・人数・材料と元の行・元レシピのURLだけ。調理手順と画像は保存しない。
- ページの取得はサーバー(`api/recipe-import.js`、Vercel Function)で行う。ログイン中のユーザーだけが使え、
  対応サイト以外の URL と、対応サイト以外へのリダイレクトはたどらない(3MB・8秒まで)。

## 本番適用の順序

| 順 | 操作 | 確認 |
| --- | --- | --- |
| 1 | `supabase/manual/012_precheck.sql` → `supabase/migrations/012_recipe_import.sql`(全文)→ `supabase/manual/012_postcheck.sql` | postcheck がすべて true、件数が precheck と同じ |
| 2 | v1.3.0 をマージして本番デプロイ、`v1.3.0` タグ | 下の動作確認 |

```sql
-- 012 の確認
select column_name from information_schema.columns
where table_schema = 'public' and table_name in ('recipes', 'recipe_ingredients')
  and column_name in ('source_key', 'source_site', 'servings', 'raw_text');   -- 4行
select indexname from pg_indexes where indexname = 'recipes_group_source_key_idx';  -- 1行
select count(*) from recipes;  -- 適用前と同じ
```

012 は列・インデックス・関数 remove_ingredient を追加するだけで、既存のレシピと材料は変わらない(データの変更なし)。
冷蔵庫での削除は remove_ingredient を通り、レシピで使う食材は在庫0で残る(レシピの材料が消えない)。既存の RLS がそのまま新しい列にも効く。
Vercel の本番の環境変数 `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を、Function も使う(追加の設定は不要)。

## 動作確認(デプロイ後、iPhone)

1. レシピ → 追加 で、DELISH KITCHEN のレシピURLを貼って「読み込む」。料理名と材料が入る。
2. 分量を確かめて「レシピを保存」。レシピ詳細で、材料と「作れる/不足」が出る。元レシピへのリンクが開く。
3. 同じURLをもう一度読み込むと「すでに保存されています」と出る。

## 切り戻し

アプリを v1.2.0 に Instant Rollback する。012 の列は残っても v1.2.0 の動作に影響しない。
