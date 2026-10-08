// ビルド時に決まる実行環境。vite.config.js の define で __APP_ENV__ を埋め込む。
//   'production' : Vercel の本番デプロイ
//   'preview'    : Vercel の Preview デプロイ(本番DBに接続しない)
//   'development': Vercel の Development 環境(本番DBに接続しない)
//   'local'      : 手元の vite / vite build(VERCEL_ENV なし)
//
// 本番以外の Supabase プロジェクトを持たない運用のため、Vercel 上の production 以外では
// 本番DBへ接続しない。Preview でのテスト操作が本番の家族データを書き換えるのを防ぐ。
/* global __APP_ENV__, __DB_ENABLED__ */
export const APP_ENV = typeof __APP_ENV__ === 'string' ? __APP_ENV__ : 'local'

export function isDbEnabledFor(appEnv) {
  return appEnv === 'production' || appEnv === 'local'
}

// ビルド時の真偽値リテラル。テストなど define がない環境では APP_ENV から求める
export const DB_ENABLED = typeof __DB_ENABLED__ === 'boolean' ? __DB_ENABLED__ : isDbEnabledFor(APP_ENV)
