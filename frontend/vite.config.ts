import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'プチ麻雀',
        short_name: 'プチ麻雀',
        description: '手牌5枚の麻雀ローグライト',
        theme_color: '#1e4637',
        background_color: '#1e4637',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        lang: 'ja',
        // 元の絵は public/pujan-icon.svg。PNG はそこから作った（TAKO-SEN と同じ大きさをそろえる）
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // manifest のアイコンは下の glob に任せる
      includeManifestIcons: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        // 大きいアイコンは追加のときにシステムが取りに来るので、オフライン用には持たない
        globIgnores: ['pwa-512.png', 'pwa-maskable-512.png', 'apple-touch-icon.png'],
        // API は Worker が答える。ユーザーごとに内容が変わるのでキャッシュしない
        navigateFallbackDenylist: [/^\/api\//],
        // 書体（Google Fonts）は一度読んだら手元に置き、オフラインでも同じ書体で描く。
        // 日本語の書体は文字の範囲ごとに 100 を超えるファイルに分かれるので、ファイルの上限は大きめにする
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css', cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@pujan/engine': path.resolve(__dirname, '../engine/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    // API は同一オリジン（kan-game.app の ID の Cookie はそちらにしか付かない）。
    // scripts/dev.mjs が backend の wrangler dev を空いているポートで起こし、ここへ渡す
    proxy: {
      '/api': `http://127.0.0.1:${process.env.PUJAN_API_PORT || 8788}`,
    },
  },
});
