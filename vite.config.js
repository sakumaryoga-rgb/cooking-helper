import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel が付与する VERCEL_ENV(production / preview / development)。手元では未設定なので 'local'。
// src/lib/runtimeEnv.js が参照し、production と local 以外では本番DBに接続しない。
const APP_ENV = process.env.VERCEL_ENV || 'local'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_ENV__: JSON.stringify(APP_ENV),
    // 真偽値のリテラルとして埋め込むことで、false のビルドでは本番DBの接続先と鍵の参照が
    // 最小化の段階で削除される(関数経由の判定だと削除されない)
    __DB_ENABLED__: JSON.stringify(APP_ENV === 'production' || APP_ENV === 'local'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'autoUpdate' では vite-plugin-pwa の onNeedRefresh が発火せず、更新通知を出せない。
      // 'prompt' は「自動で skipWaiting しない」モードの意味で、更新の反映は
      // UpdatePrompt の「更新する」で行う(BASKETBALL STATS と同じ構成)。
      registerType: 'prompt',
      // main.jsx で virtual:pwa-register を使い、定期的な更新チェックを自前で行うため、
      // 何もしない自動注入スクリプト(registerSW.js)は無効化する。
      injectRegister: false,
      workbox: {
        // clientsClaim がないと、skipWaiting 後も開いているタブが新しい SW に引き継がれず、
        // controllerchange が発火しないため「更新する」を押してもリロードされない。
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      // manifest のアイコンは自動でプリキャッシュされる。ファイル名を変えたので、古いアイコンは
      // cleanupOutdatedCaches で新しい SW の有効化時に削除される
      includeAssets: ['apple-touch-icon.png', 'favicon.ico', 'favicon-32.png'],
      manifest: {
        name: 'COOKDOOR',
        short_name: 'COOKDOOR',
        description: '冷蔵庫の食材からつくれる料理がわかるアプリ',
        lang: 'ja',
        // start_url と scope(未指定 = start_url と同じ '/')は変えない。変えると別アプリ扱いになる
        start_url: '/',
        display: 'standalone',
        // 起動時のスプラッシュ(Android)を公式アイコンの黄色にする
        background_color: '#FED712',
        theme_color: '#FBFBFA',
        icons: [
          { src: 'icons/cookdoor-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/cookdoor-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/cookdoor-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/cookdoor-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(fileURLToPath(new URL('.', import.meta.url)), './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
})
