# cooking-helper(COOKDOOR)

家族で使っている料理ヘルプアプリ。将来は一般公開と収益化を目指す。
リポジトリ名・DBのテーブル名は cooking-helper 時代のまま変えない。

## 本番DBについて(最重要)

- Supabase は本番プロジェクトしかない。開発用のクラウドDBは作らない。
- 本番DBへの変更(SQL Editor でのマイグレーション実行、データの変更・削除)は、
  事前に対象と影響範囲を確認してユーザーに示し、必ずユーザーの明示的な承認を得てから行う。読み取り専用の確認は可。
- 本番データを使った破壊的なテストはしない。DBのテストは `npm run test:db`
  (ローカル/CI の素の PostgreSQL + `supabase/tests/shim.sql`)で行い、合成データだけを使う。
- 変更前のバックアップと復元確認は `docs/db-backup-restore.md` の手順に従う。
- 新しいマイグレーションは `supabase/migrations/` に連番で追加し、何度実行しても同じ結果に
  なるように書く(if not exists、create or replace、drop policy if exists)。
  security definer 関数は `set search_path = public, extensions` とし、
  returns table の列名はテーブルの列名と重ねない(migration 008 の 42702 の再発防止)。
- 本番DBにテスト用の食材やダミーデータを作らない。動作確認のために本番のアプリで食材・食材マスタ・レシピ・別名などを作らない(「削除テスト用」のような
  テストの行が家族の画面に出てしまうため)。画面の確認は、本番DBに接続しないモックのハーネス
  (`vite` + `@/supabaseClient` の差し替え)か、ローカルDBの合成データで行う(UI・スワイプ・削除の確認も同じ)。
  やむを得ず本番で作った場合は、確認が終わったらすぐ消し、ユーザーに報告する。
- Vercel の production 以外(Preview など)のビルドは本番DBに接続しない
  (`src/lib/runtimeEnv.js`、`vite.config.js` の `__DB_ENABLED__`)。この仕組みを外さない。

## リリースのたびに行うこと

1. `npm run lint`、`npm test`、`npm run build`、`npm run test:db` をすべて通す。
2. `package.json` の `version` を上げる(グループ画面の下部に表示される)。
3. main へのマージとデプロイはユーザーの承認後に行い、`v<バージョン>` の git タグを付ける。

## PWA更新機能を変更するとき

`docs/pwa-update-regression-checklist.md` の5項目を、`vite build` + `vite preview` の
本番相当環境で再検証する。見た目だけでなく `reg.waiting` / `controller` も確認する。
