/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** kan/game のローカルのポータル（scripts/dev.mjs が渡す）。既定は http://localhost:8787 */
  readonly VITE_KAN_GAME_PORTAL?: string;
}

/** 画面の版（package.json の版と git のコミット。vite.config.ts の define が埋め込む。感想に添える） */
declare const __APP_VERSION__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
