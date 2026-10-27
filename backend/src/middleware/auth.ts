import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { allowedOrigins, authenticate } from '../lib/id-auth';

/**
 * kan-game.app の ID の Cookie を求め、`accountId` に ID を入れる（vegtab の middleware/auth.ts と同じ）。
 *
 * Cookie は kan-game.app へのどの要求にも付くので、書き込む要求は許可したオリジンからのものに限る。
 * ブラウザは書き込む要求に必ず Origin を付ける。同じオリジンの GET は Origin を省くことがあるので、
 * GET には求めない（GET では何も書かない）。
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const origin = c.req.header('Origin');
  if (origin ? !allowedOrigins(c.env).includes(origin) : c.req.method !== 'GET') {
    return c.json({ error: 'forbidden_origin' }, 403);
  }

  // 退会した ID を断るのは書き込む要求だけ（GET では何も書かない）
  const auth = await authenticate(c.req.raw, c.env, c.req.method !== 'GET');
  if (auth.status === 'unauthorized') return c.json({ error: 'unauthorized' }, 401);
  // 画面はこのあと ID 基盤に新しい ID を求める
  if (auth.status === 'deleted') return c.json({ error: 'id_deleted' }, 410);

  c.set('accountId', auth.accountId);
  await next();
});
