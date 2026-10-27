/**
 * kan-game.app のポータルのページ。アカウント（引き継ぎ・復旧コード・退会）、利用規約、プライバシーポリシーは
 * 各ゲームではなくポータルにある。ポータルはこのページのホストに合わせる（pujan-dev.kan-game.app → dev.kan-game.app）
 * ので、ビルドが別の環境のポータルを指すことはない。ローカルでは kan/game のローカルのポータル
 * （scripts/dev.mjs が VITE_KAN_GAME_PORTAL で渡す）。TAKO-SEN の src/ui/auth.ts の portalUrl と同じ。
 */
export function portalUrl(path: '/' | '/account' | '/privacy' | '/terms', host = window.location.hostname): string {
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const portal = host.endsWith('.kan-game.app')
    ? host.split('.')[0].endsWith('-dev')
      ? 'https://dev.kan-game.app'
      : 'https://kan-game.app'
    : local
      ? import.meta.env.VITE_KAN_GAME_PORTAL || 'http://localhost:8787'
      : 'https://kan-game.app';
  return new URL(path, portal).href;
}
