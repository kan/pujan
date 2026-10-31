import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import './theme.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');

// Service Worker（vite.config.ts、autoUpdate）。新しい版が入ると自分で切り替わり、ページを読み込み直す
// （途中のランは操作ログから再開する）。デプロイの前に読み込んだ画面のまま遊び続けないようにする（TAKO-SEN と同じ）
registerSW({ immediate: true });
