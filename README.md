# cooking-helper(COOKDOOR)

冷蔵庫の在庫と家族のレシピを共有し、今の在庫で作れる料理を判定する PWA。
React 19 + Vite + Supabase。開発のルールは [CLAUDE.md](CLAUDE.md) を参照。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run lint` | oxlint |
| `npm test` | Vitest(ロジックと画面のテスト) |
| `npm run test:db` | ローカル PostgreSQL での DB テスト。`PGHOST` などで接続先を指定する |
| `npm run build` | 本番ビルド |

環境変数は `.env.example` を参照。
