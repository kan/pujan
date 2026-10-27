import { importVerificationKeys, verifyIdCookie, type IdKey } from './id-token';
import type { IdRpc } from './id-rpc';
import type { Bindings } from '../types';

/**
 * 要求の ID は、Cookie の kan-game.app の ID（kan/game docs/ID_DESIGN.md「ID と Cookie」）。
 * ID 基盤の公開鍵でここで検証し、ID 基盤には問い合わせない（vegtab の lib/id-auth.ts と同じ）。
 */
export type Authentication =
  | { status: 'ok'; accountId: string }
  | { status: 'unauthorized' }
  | { status: 'deleted' };

// isolate ごとに 1 回だけ読み込む（設定が変われば読み直す）
let cachedKeys: { json: string; keys: Promise<IdKey[]> } | undefined;

function verificationKeys(json: string): Promise<IdKey[]> {
  if (cachedKeys?.json !== json) {
    const keys = importVerificationKeys(json);
    // 読み込みに失敗したら、覚えずに次の要求で読み直す
    keys.catch(() => {
      if (cachedKeys?.keys === keys) cachedKeys = undefined;
    });
    cachedKeys = { json, keys };
  }
  return cachedKeys.keys;
}

/**
 * 要求の Cookie の ID。退会した ID の Cookie は最長 400 日有効なので、
 * 記録を書かせないように、書き込む要求（checkDeleted）ではここで断る（ID_DESIGN.md「退会」）。
 * 読むだけの要求（ランキングなど）では、D1 への問い合わせを省いて確かめない。
 */
export async function authenticate(request: Request, env: Bindings, checkDeleted: boolean): Promise<Authentication> {
  const claims = await verifyIdCookie(
    request.headers.get('Cookie'),
    env.ID_COOKIE_NAME,
    await verificationKeys(env.ID_PUBLIC_KEYS),
    env.ID_ISSUER,
    Date.now(),
  );
  if (!claims) return { status: 'unauthorized' };
  if (!checkDeleted) return { status: 'ok', accountId: claims.sub };
  const deleted = await env.DB.prepare('SELECT 1 FROM deleted_accounts WHERE account_id = ?').bind(claims.sub).first();
  return deleted ? { status: 'deleted' } : { status: 'ok', accountId: claims.sub };
}

/**
 * ID binding 越しの ID 基盤の RPC（ID_DESIGN.md「ゲームとの RPC」）。`wrangler types` は binding を
 * ただの Fetcher として型付けし、IdRpc は何も import しないので、ここで型を付ける。
 */
export function idPlatform(env: Pick<Bindings, 'ID'>): IdRpc {
  return env.ID as unknown as IdRpc;
}

/** API を呼んでよいオリジン（ALLOWED_ORIGINS のカンマ区切り） */
export function allowedOrigins(env: Pick<Bindings, 'ALLOWED_ORIGINS'>): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}
