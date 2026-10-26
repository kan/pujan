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
        // TODO: アイコン（docs/SPEC.md §6 フェーズ 2）
        icons: [],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        // API は Worker が答える。ユーザーごとに内容が変わるのでキャッシュしない
        navigateFallbackDenylist: [/^\/api\//],
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
