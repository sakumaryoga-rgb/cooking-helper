# 旧機能の削除計画(Phase 7)

削除用の SQL は `supabase/pending/017_drop_legacy.sql`(CI の DB テストでは適用されない置き場)。
**今回は適用しない。** 下の前提がすべて揃ってから、承認を得て `supabase/migrations/` に移し、番号を確定して実行する。

## 削除の対象と依存

| 対象 | 置き換え先 | 現行アプリ(v1.8.0)の呼び出し | 旧版アプリの呼び出し |
| --- | --- | --- | --- |
| `join_group(text)` | `join_group_with_invite(text)` | なし | v1.1.x 以前(010 で停止済み。呼ぶと停止メッセージ) |
| `cook_recipe(uuid, jsonb)` | `cook_recipe_v2(uuid, jsonb, uuid)` | なし | v1.4.x 以前の「作った」 |
| `adjust_ingredient_quantity(uuid, numeric, boolean)` | `adjust_stock(uuid, numeric, boolean, date, date)` | なし(v1.8.0 で冷蔵庫の＋/−を切り替え) | v1.7.x 以前の冷蔵庫の＋/− |
| `groups.invite_code` 列 | 招待トークン(group_invites) | なし | v1.1.x 以前の画面表示(値は 011 で null にする) |

## 削除の前提(すべて必要)

1. v1.8.0 を本番にリリース済み。
2. `public/version.json` の `minSupportedVersion` を 1.8.0 にしたリリースを出し、旧版に更新を強制した。
3. `usage_reports.sql` の 4(バージョン別)で、直近7日に 1.8.0 より古い版の利用がない。
4. Migration 011(旧招待コードの値の削除)を適用済み。017 は値が残っていると中止する。

## 注意

- 017 は `groups.invite_code` 列を削除する(データの削除)。元に戻すにはバックアップが必要。
- 017 の後に 015 を再実行すると、旧関数が作り直される。015 の再実行は避ける。
- 017 を `supabase/migrations/` に移すときは、旧関数を使っている DB テスト(inventory・invites・cooking・recipe_import)を新しい関数に書き換える。
