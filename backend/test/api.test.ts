import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { apply, createGame, isFinished, newLog, weekOf, type GameAction, type RunLog } from '@pujan/engine';
import { botAction } from '../../engine/src/sim';
import { call, get, idIssuer, newUser, ORIGIN, post, resetDb, type TestUser } from './helpers';
import { createTestIdIssuer } from './kan-game/test-id-cookie';
import { GameService } from '../src/game-service';

beforeEach(resetDb);

/** そのシードのランを AI に終わりまで遊ばせた操作ログ（ショップでは何も買わない） */
function playedLog(seed: number): RunLog {
  const log = newLog(seed);
  let g = createGame(seed);
  const act = (a: GameAction) => {
    g = apply(g, a);
    log.actions.push(a);
  };
  while (!isFinished(g)) {
    if (!g.kyoku) act({ type: 'leave' });
    else if (!g.kyoku.result) act(botAction(g.kyoku, { target: '和了形' }));
    else act({ type: 'settle', renchan: true });
  }
  return log;
}

/** ランを始め、AI に遊ばせて記録を送る */
async function playRun(user: TestUser) {
  const started = (await (await post('/api/runs', user)).json()) as { id: string; seed: number };
  const log = playedLog(started.seed);
  const res = await post(`/api/runs/${started.id}/finish`, user, { log });
  return { started, log, res };
}

describe('ID の Cookie', () => {
  it('Cookie がない・知らない鍵・別の発行元は 401', async () => {
    const stranger = await createTestIdIssuer({ issuer: idIssuer.issuer, cookieName: idIssuer.cookieName });
    const id = crypto.randomUUID();
    for (const cookie of [undefined, await stranger.cookie(id), await idIssuer.cookie(id, { iss: 'kan-game.app' })]) {
      const res = await call('/api/me', { headers: cookie ? { Cookie: cookie } : {} });
      expect(res.status).toBe(401);
    }
  });

  it('退会した ID の書き込みは 410（読むだけの要求は確かめない）', async () => {
    const user = await newUser();
    await env.DB.prepare('INSERT INTO deleted_accounts (account_id, deleted_at) VALUES (?, ?)').bind(user.id, 1).run();
    expect((await post('/api/runs', user)).status).toBe(410);
    expect((await get('/api/me', user)).status).toBe(200);
  });

  it('書き込みは許可したオリジンからだけ', async () => {
    const user = await newUser();
    const start = (origin?: string) =>
      call('/api/runs', { method: 'POST', headers: { Cookie: user.headers.Cookie, ...(origin ? { Origin: origin } : {}) } });
    expect((await start('https://evil.example')).status).toBe(403);
    expect((await start()).status).toBe(403);
    expect((await start(ORIGIN)).status).toBe(201);
  });
});

describe('名前と公開への同意', () => {
  it('同意する前は名前がなく、登録すると名前が付く', async () => {
    const user = await newUser();
    expect(await (await get('/api/me', user)).json()).toEqual({ id: user.id, name: null });
    const res = await post('/api/profile', user, { name: '雀士A' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: '雀士A' });
    expect(await (await get('/api/me', user)).json()).toEqual({ id: user.id, name: '雀士A' });
  });

  it('ほかの ID の名前は 409、規則に合わない名前は 400', async () => {
    await newUser({ name: '雀士A' });
    const user = await newUser();
    expect((await post('/api/profile', user, { name: '雀士A' })).status).toBe(409);
    expect((await post('/api/profile', user, { name: 'x' })).status).toBe(400);
    expect((await post('/api/profile', user, {})).status).toBe(400);
  });
});

describe('ランの記録', () => {
  it('サーバーが渡したシードのランを再生して成績を記録し、週の最高記録にする', async () => {
    const user = await newUser({ name: '雀士A' });
    const { log, res } = await playRun(user);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wavesCleared: number; totalScore: number; week: string; best: boolean };
    expect(body.best).toBe(true);
    expect(body.week).toBe(weekOf(Date.now()));
    const row = await env.DB.prepare('SELECT waves_cleared, total_score FROM weekly_best WHERE account_id = ?')
      .bind(user.id)
      .first<{ waves_cleared: number; total_score: number }>();
    expect(row).toEqual({ waves_cleared: body.wavesCleared, total_score: body.totalScore });
    expect(log.actions.length).toBeGreaterThan(10);
  });

  it('同じ記録の再送は成績を変えずに duplicate として答える', async () => {
    const user = await newUser();
    const { started, log, res } = await playRun(user);
    const first = (await res.json()) as Record<string, unknown>;
    const again = await post(`/api/runs/${started.id}/finish`, user, { log });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ...first, duplicate: true });
  });

  it('別のシードのログ、終わっていないログ、ルールを変えたログ、できない操作のあるログは 422', async () => {
    const user = await newUser();
    const started = (await (await post('/api/runs', user)).json()) as { id: string; seed: number };
    const log = playedLog(started.seed);
    const bad: RunLog[] = [
      playedLog(started.seed + 1),
      { ...log, actions: log.actions.slice(0, 5) },
      { ...log, base: { ...log.base, holdSlots: 4 } },
      { ...log, actions: [{ type: 'reroll' }, ...log.actions] },
    ];
    for (const b of bad) expect((await post(`/api/runs/${started.id}/finish`, user, { log: b })).status).toBe(422);
    // 正しいログはそのあとでも記録できる
    expect((await post(`/api/runs/${started.id}/finish`, user, { log })).status).toBe(200);
  });

  it('新しいランを始めると、終わっていない前のランは消えて記録できない（終わったランは残る）', async () => {
    const user = await newUser();
    const { started: done } = await playRun(user);
    const first = (await (await post('/api/runs', user)).json()) as { id: string; seed: number };
    await post('/api/runs', user);
    const res = await post(`/api/runs/${first.id}/finish`, user, { log: playedLog(first.seed) });
    expect(res.status).toBe(404);
    const rows = await env.DB.prepare('SELECT id, finished_at IS NOT NULL AS finished FROM runs WHERE account_id = ?')
      .bind(user.id)
      .all<{ id: string; finished: number }>();
    // 終わったラン 1 つと、進めているラン 1 つ
    expect(rows.results).toHaveLength(2);
    expect(rows.results.find((r) => r.id === done.id)?.finished).toBe(1);
  });

  it('週はランを始めた時刻で決まる', async () => {
    const user = await newUser();
    const started = (await (await post('/api/runs', user)).json()) as { id: string; seed: number };
    // 前の週の日曜に始めたことにする
    const lastSunday = Date.parse(`${weekOf(Date.now())}T00:00:00+09:00`) - 60 * 60 * 1000;
    await env.DB.prepare('UPDATE runs SET started_at = ? WHERE id = ?').bind(lastSunday, started.id).run();
    const res = await post(`/api/runs/${started.id}/finish`, user, { log: playedLog(started.seed) });
    expect(((await res.json()) as { week: string }).week).toBe(weekOf(lastSunday));
    expect(weekOf(lastSunday)).not.toBe(weekOf(Date.now()));
  });

  it('ほかの ID のランは 404、版の違うログは 409', async () => {
    const owner = await newUser();
    const other = await newUser();
    const started = (await (await post('/api/runs', owner)).json()) as { id: string; seed: number };
    const log = playedLog(started.seed);
    expect((await post(`/api/runs/${started.id}/finish`, other, { log })).status).toBe(404);
    const res = await post(`/api/runs/${started.id}/finish`, owner, { log: { ...log, engineVersion: log.engineVersion + 1 } });
    expect(res.status).toBe(409);
  });

  it('形の違う本文は 400', async () => {
    const user = await newUser();
    const started = (await (await post('/api/runs', user)).json()) as { id: string };
    expect((await post(`/api/runs/${started.id}/finish`, user, { log: { seed: 'x' } })).status).toBe(400);
  });
});

describe('週ごとのランキング', () => {
  async function putBest(name: string | undefined, waves: number, score: number) {
    const user = await newUser({ name });
    await env.DB.prepare(
      'INSERT INTO weekly_best (week, account_id, run_id, waves_cleared, total_score, finished_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(weekOf(Date.now()), user.id, crypto.randomUUID(), waves, score, Date.now())
      .run();
    return user;
  }

  it('突破した場の数 → 合計点の順。同じ成績は同じ順位。名前のない ID は載らないが本人には成績を返す', async () => {
    const a = await putBest('雀士A', 2, 3000);
    await putBest('雀士B', 3, 1000);
    await putBest('雀士C', 2, 3000);
    await putBest('雀士D', 2, 2000);
    const anon = await putBest(undefined, 4, 99999);

    const ranking = (await (await get('/api/rankings/weekly', a)).json()) as {
      entries: { rank: number; name: string; isMe: boolean }[];
      me: { rank: number | null };
    };
    expect(ranking.entries.map((e) => [e.rank, e.name])).toEqual([
      [1, '雀士B'],
      [2, '雀士A'],
      [2, '雀士C'],
      [4, '雀士D'],
    ]);
    expect(ranking.entries.find((e) => e.isMe)?.name).toBe('雀士A');
    expect(ranking.me?.rank).toBe(2);

    const mine = (await (await get('/api/rankings/weekly', anon)).json()) as { me: { rank: number | null; wavesCleared: number } };
    expect(mine.me).toEqual({ rank: null, wavesCleared: 4, totalScore: 99999 });
  });

  it('週は月曜の日付で指定する', async () => {
    const user = await newUser();
    expect((await get('/api/rankings/weekly?week=2026-10-27', user)).status).toBe(400); // 火曜
    expect((await get('/api/rankings/weekly?week=2026-10-26', user)).status).toBe(200);
  });
});

describe('退会（GameService.deleteAccount）', () => {
  it('記録を消し、以後その ID の要求を断る。何度呼んでもよい', async () => {
    const user = await newUser({ name: '雀士A' });
    await playRun(user);
    const service = new GameService({} as never, env as never);
    await service.deleteAccount(user.id);
    await service.deleteAccount(user.id);
    for (const table of ['runs', 'weekly_best', 'profiles']) {
      const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`).bind(user.id).first<{ n: number }>();
      expect(left?.n).toBe(0);
    }
    expect((await post('/api/runs', user)).status).toBe(410);
  });
});
