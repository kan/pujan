/**
 * プチ麻雀の API（docs/SPEC.md §5）。SPA は同じ Worker の Static Assets が配り、/api/* だけがここに届く。
 *
 * - /api/id/*: kan-game.app の ID 基盤へ中継する
 * - /api/me・/api/profile: ランキングに出す名前と公開への同意
 * - /api/runs: ランの開始（サーバーがシードを渡す）と、終わったランの記録（操作ログを再生して確かめる）
 * - /api/rankings/weekly: 週ごとのランキング
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { RunLog } from '@pujan/engine';
import type { AppEnv } from './types';
import { authMiddleware } from './middleware/auth';
import { idPlatform } from './lib/id-auth';
import { getProfileName, nameOutcome, registerProfile } from './lib/profile';
import { finishRun, MAX_ACTIONS, startRun } from './lib/runs';
import { loadProgress } from './lib/progress';
import { weeklyRanking } from './lib/ranking';
import { isWeek, weekOf } from '@pujan/engine';

export { GameService } from './game-service';

const app = new Hono<AppEnv>();

// kan-game.app の ID の API を、このオリジンのものとして中継する（kan/game docs/ID_DESIGN.md「HTTP の API」）。
// 要求はそのまま渡す: ID 基盤が CF-Connecting-IP で頻度を制限し、Origin も自分で確かめる
app.all('/api/id/*', async (c) => {
  try {
    return await c.env.ID.fetch(c.req.raw);
  } catch (error) {
    console.error(JSON.stringify({ event: 'id_proxy_failure', error: String(error) }));
    return c.json({ error: 'service_unavailable' }, 503);
  }
});

app.get('/api/health', (c) => c.json({ status: 'ok' }));

const api = new Hono<AppEnv>();
api.use('*', authMiddleware);

/** 名前は kan-game.app 全体の規則で ID 基盤が確かめる。ここでは長さの上限だけ見る（UTF-16 で 256 単位） */
const profileSchema = z.object({ name: z.string().min(1).max(256) });

// GET /api/me — ランキングに出す名前（同意する前は null）と解禁の状態
api.get('/me', async (c) => {
  const accountId = c.get('accountId');
  const [name, progress] = await Promise.all([getProfileName(c.env.DB, accountId), loadProgress(c.env.DB, accountId)]);
  return c.json({ id: accountId, name, progress });
});

// POST /api/profile — kan-game.app の名前を登録し（登録済みならその名前を使う）、ここでの公開に同意する
api.post('/profile', async (c) => {
  const body = profileSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid_request' }, 400);
  const accountId = c.get('accountId');
  const outcome = nameOutcome(await idPlatform(c.env).registerName(accountId, body.data.name));
  switch (outcome.status) {
    case 'name_taken':
      return c.json({ error: 'name_taken' }, 409);
    case 'invalid':
      return c.json({ error: 'invalid_name' }, 400);
    case 'no_id':
      return c.json({ error: 'id_deleted' }, 410);
  }
  await registerProfile(c.env.DB, accountId, outcome.name);
  return c.json({ name: outcome.name });
});

/** ランを始めるときの雀士と段位（本文がなければ標準の雀士・初段） */
const startSchema = z
  .object({ character: z.string().max(32).default('standard'), dan: z.number().int().default(0) })
  .default({ character: 'standard', dan: 0 });

// POST /api/runs — ランを始める。シード・記録の ID・始めの条件を返す。まだ選べない雀士や段位なら 403
api.post('/runs', async (c) => {
  // 本文がない（JSON でない、null）ときは undefined にして、標準の雀士・初段にする
  const body = startSchema.safeParse((await c.req.json().catch(() => undefined)) ?? undefined);
  if (!body.success) return c.json({ error: 'invalid_request' }, 400);
  const run = await startRun(c.env.DB, c.get('accountId'), body.data);
  if (!run) return c.json({ error: 'locked' }, 403);
  return c.json(run, 201);
});

/** 操作ログ（engine の RunLog）。操作の中身は replay() が確かめる */
const finishSchema = z.object({
  log: z.object({
    engineVersion: z.number().int(),
    seed: z.number().int(),
    start: z.object({
      character: z.string().max(32),
      dan: z.number().int(),
      unlockedYaku: z.array(z.string().max(32)).max(100),
    }),
    actions: z.array(z.looseObject({ type: z.string() })).max(MAX_ACTIONS),
  }),
});

// POST /api/runs/:id/finish — 終わったランの操作ログを送る。再生して確かめ、成績と週の最高記録を書く
api.post('/runs/:id/finish', bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
  const body = finishSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid_request' }, 400);
  // 形はここで、操作の中身は再生で確かめる
  const log = body.data.log as RunLog;
  const result = await finishRun(c.env.DB, c.get('accountId'), c.req.param('id'), log);
  switch (result.status) {
    case 'recorded':
      return c.json({
        ...result.summary,
        week: result.week,
        best: result.best,
        duplicate: result.duplicate,
        progress: result.progress,
      });
    case 'not_found':
      return c.json({ error: 'not_found' }, 404);
    case 'superseded':
      return c.json({ error: 'superseded' }, 409);
    case 'version_mismatch':
      return c.json({ error: 'version_mismatch' }, 409);
    case 'invalid':
      console.warn(JSON.stringify({ event: 'invalid_run', reason: result.reason }));
      return c.json({ error: 'invalid_run' }, 422);
  }
});

// GET /api/rankings/weekly?week=YYYY-MM-DD — 週ごとのランキング（省略時は今週）
api.get('/rankings/weekly', async (c) => {
  const week = c.req.query('week') ?? weekOf(Date.now());
  if (!isWeek(week)) return c.json({ error: 'invalid_week' }, 400);
  return c.json(await weeklyRanking(c.env.DB, week, c.get('accountId')));
});

app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

export default app;
