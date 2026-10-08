import { createClient } from '@supabase/supabase-js'
import { DB_ENABLED } from '@/lib/runtimeEnv'

/* global __DB_ENABLED__ */
// __DB_ENABLED__ を直接参照する(DB_ENABLED 経由だと最小化で分岐が消えない)
const BUILD_DB_ENABLED = typeof __DB_ENABLED__ === 'boolean' ? __DB_ENABLED__ : DB_ENABLED

// DB_ENABLED はビルド時の定数なので、Preview ビルドでは下の import.meta.env の参照ごと
// 削除され、本番の接続先と鍵がバンドルに含まれない。
const supabaseUrl = BUILD_DB_ENABLED ? import.meta.env.VITE_SUPABASE_URL : undefined
const supabaseAnonKey = BUILD_DB_ENABLED ? import.meta.env.VITE_SUPABASE_ANON_KEY : undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (BUILD_DB_ENABLED && !isSupabaseConfigured) {
  console.warn(
    'Supabase の環境変数が未設定です。.env.local に VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。'
  )
}

// 接続しない環境では、名前解決されないことが保証された .invalid ドメインを指す。
// 万一どこかのコードが通信しても、本番DBには一切届かない。
export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://db-disabled.invalid',
  isSupabaseConfigured ? supabaseAnonKey : 'db-disabled'
)
