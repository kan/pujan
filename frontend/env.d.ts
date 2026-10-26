/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** kan/game のローカルのポータル（scripts/dev.mjs が渡す）。既定は http://localhost:8787 */
  readonly VITE_KAN_GAME_PORTAL?: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
