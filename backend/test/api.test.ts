import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  analyzeRun,
  apply,
  createGame,
  DEFAULT_START,
  isFinished,
  makeMission,
  newLog,
  replay,
  runSummary,
  weekOf,
  type GameAction,
  type Progress,
  type RunLog,
  type RunStart,
  type RunSummary,
} from '@pujan/engine';
import { botAction } from '../../engine/src/sim';
import { call, get, idIssuer, newUser, ORIGIN, post, resetDb, type TestUser } from './helpers';
import { createTestIdIssuer } from './kan-game/test-id-cookie';
import { GameService } from '../src/game-service';
import { ACCOUNT_TABLES } from '../src/lib/account';
import { UNFINISHED_KEPT } from '../src/lib/runs';

beforeEach(resetDb);

/** そのシードのランを AI に終わりまで遊ばせた操作ログ（お題は前の枠、ショップでは何も買わない） */
function playedLog(seed: number, start: RunStart = DEFAULT_START): RunLog {
  const log = newLog(seed, start);
  let g = createGame(seed, { start });
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

type Started = { id: string; seed: number; start: RunStart };

/** ランを始め、AI に遊ばせて記録を送る */
async function playRun(user: TestUser, choice?: { character: string; dan: number }) {
  const started = (await (await post('/api/runs', user, choice)).json()) as Started;
  const log = playedLog(started.seed, started.start);
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
    expect(await (await get('/api/me', user)).json()).toMatchObject({ id: user.id, name: null });
    const res = await post('/api/profile', user, { name: '雀士A' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: '雀士A' });
    expect(await (await get('/api/me', user)).json()).toMatchObject({ id: user.id, name: '雀士A' });
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
    const body = (await res.json()) as RunSummary & { week: string; best: boolean };
    expect(body.best).toBe(true);
    expect(body.week).toBe(weekOf(Date.now()));
    // 成績はログを再生した結果から出す
    const s = runSummary(replay(log).run);
    expect(body).toMatchObject(s);
    const row = await env.DB.prepare('SELECT missions, cleared, total_score, record_score FROM weekly_best WHERE account_id = ?')
      .bind(user.id)
      .first<{ missions: string; cleared: number; total_score: number; record_score: number }>();
    expect(row).toEqual({ missions: JSON.stringify(s.missions), cleared: Number(s.cleared), total_score: s.totalScore, record_score: s.recordScore });
    expect(log.actions.length).toBeGreaterThan(10);
  });

  it('局を終えた途中経過を残す。終わったラン・ほかの ID のラン・形の違う本文は受け付けない', async () => {
    const user = await newUser();
    const other = await newUser();
    const started = (await (await post('/api/runs', user)).json()) as Started;
    const lastKyoku = () =>
      env.DB.prepare('SELECT last_kyoku, last_kyoku_at IS NOT NULL AS at FROM runs WHERE id = ?')
        .bind(started.id)
        .first<{ last_kyoku: number | null; at: number }>();
    expect(await lastKyoku()).toEqual({ last_kyoku: null, at: 0 });
    expect((await post(`/api/runs/${started.id}/progress`, user, { kyoku: 2 })).status).toBe(200);
    // 届く順が前後しても戻さない
    expect((await post(`/api/runs/${started.id}/progress`, user, { kyoku: 1 })).status).toBe(200);
    expect(await lastKyoku()).toEqual({ last_kyoku: 2, at: 1 });
    expect((await post(`/api/runs/${started.id}/progress`, other, { kyoku: 3 })).status).toBe(404);
    for (const bad of [{ kyoku: 0 }, { kyoku: 'x' }, {}]) {
      expect((await post(`/api/runs/${started.id}/progress`, user, bad)).status).toBe(400);
    }
    await post(`/api/runs/${started.id}/finish`, user, { log: playedLog(started.seed) });
    expect((await post(`/api/runs/${started.id}/progress`, user, { kyoku: 9 })).status).toBe(404);
    expect((await lastKyoku())?.last_kyoku).toBe(2);
  });

  it('同じ記録の再送は成績を変えずに duplicate として答える', async () => {
    const user = await newUser();
    const { started, log, res } = await playRun(user);
    const first = (await res.json()) as Record<string, unknown>;
    const again = await post(`/api/runs/${started.id}/finish`, user, { log });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ...first, duplicate: true });
  });

  it('別のシードのログ、終わっていないログ、始めの条件を変えたログ、できない操作のあるログは 422', async () => {
    const user = await newUser();
    const started = (await (await post('/api/runs', user)).json()) as Started;
    const log = playedLog(started.seed);
    const bad: RunLog[] = [
      playedLog(started.seed + 1),
      { ...log, actions: log.actions.slice(0, 5) },
      { ...log, start: { ...log.start, character: 'speed' } },
      { ...log, start: { ...log.start, unlockedYaku: ['役牌'] } },
      { ...log, actions: [{ type: 'reroll' }, ...log.actions] },
    ];
    for (const b of bad) expect((await post(`/api/runs/${started.id}/finish`, user, { log: b })).status).toBe(422);
    // 正しいログはそのあとでも記録できる
    expect((await post(`/api/runs/${started.id}/finish`, user, { log })).status).toBe(200);
  });

  it('新しいランを始めると、終わっていない前のランは記録できない（行は集計のために残る）', async () => {
    const user = await newUser();
    const { started: done, log } = await playRun(user);
    const first = (await (await post('/api/runs', user)).json()) as { id: string; seed: number };
    await post('/api/runs', user);
    const res = await post(`/api/runs/${first.id}/finish`, user, { log: playedLog(first.seed) });
    expect(res.status).toBe(409);
    const rows = await env.DB.prepare('SELECT id, finished_at IS NOT NULL AS finished, log, stats FROM runs WHERE account_id = ?')
      .bind(user.id)
      .all<{ id: string; finished: number; log: string | null; stats: string | null }>();
    // 終わったラン 1 つ、捨てたラン 1 つ、進めているラン 1 つ
    expect(rows.results).toHaveLength(3);
    const finished = rows.results.find((r) => r.id === done.id)!;
    expect(finished.finished).toBe(1);
    // 終わったランは操作ログと数えた結果を残す（プレイの集計に使う）
    expect(JSON.parse(finished.log!)).toEqual(log);
    expect(JSON.parse(finished.stats!)).toEqual(analyzeRun(log));
    expect(rows.results.filter((r) => !r.finished).every((r) => r.log === null && r.stats === null)).toBe(true);
  });

  it('終わっていないランは、1 つの ID につき新しい 20 件まで残す（終わったランは消さない）', async () => {
    const user = await newUser();
    const { started: done } = await playRun(user);
    const started: string[] = [];
    for (let i = 0; i < UNFINISHED_KEPT + 3; i++) {
      // 始めた順が時刻で決まるように、少しずつずらす
      const s = (await (await post('/api/runs', user)).json()) as Started;
      await env.DB.prepare('UPDATE runs SET started_at = ? WHERE id = ?').bind(1_000_000 + i, s.id).run();
      started.push(s.id);
    }
    // 最後の 1 回のぶんの削除を、ずらした時刻で走らせる
    const last = (await (await post('/api/runs', user)).json()) as Started;
    const rows = await env.DB.prepare('SELECT id FROM runs WHERE account_id = ? AND finished_at IS NULL').bind(user.id).all<{ id: string }>();
    expect(rows.results).toHaveLength(UNFINISHED_KEPT);
    expect(rows.results.map((r) => r.id)).toContain(last.id);
    expect(rows.results.map((r) => r.id)).not.toContain(started[0]);
    const kept = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE id = ?').bind(done.id).first<{ n: number }>();
    expect(kept?.n).toBe(1);
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

describe('引き継ぎ（雀士・段位・役の解禁）', () => {
  const me = async (user: TestUser) => ((await (await get('/api/me', user)).json()) as { progress: Progress }).progress;

  it('はじめは何も解禁されていない。まだ選べない雀士や段位では始められない', async () => {
    const user = await newUser();
    expect(await me(user)).toEqual({ yakuWon: [], bestTimes: 0, bestWaves: 0, danCleared: -1, characters: [] });
    expect((await post('/api/runs', user, { character: 'speed', dan: 0 })).status).toBe(403);
    expect((await post('/api/runs', user, { character: 'standard', dan: 1 })).status).toBe(403);
    expect((await post('/api/runs', user, { character: 'standard', dan: 'x' })).status).toBe(400);
    const started = (await (await post('/api/runs', user, { character: 'standard', dan: 0 })).json()) as Started;
    expect(started.start).toEqual(DEFAULT_START);
  });

  it('記録したランで解禁が進み、次のランの始めの条件に入る', async () => {
    const user = await newUser();
    const { res } = await playRun(user);
    const body = (await res.json()) as RunSummary & { progress: Progress };
    expect(body.progress.yakuWon.length).toBeGreaterThan(0);
    const metTimes = body.missions.filter((m) => m.met).map((m) => m.times);
    expect(body.progress.bestTimes).toBe(body.cleared ? Math.max(...metTimes) : 0);
    expect(body.progress.bestWaves).toBe(0);
    expect(await me(user)).toEqual(body.progress);
    const next = (await (await post('/api/runs', user)).json()) as Started;
    expect(next.start.unlockedYaku).toEqual(body.progress.yakuWon);
  });

  it('雀士の一覧がない前の行は、読んだときに求めた一覧を書き戻す', async () => {
    const user = await newUser();
    await env.DB.prepare('INSERT INTO progress (account_id, yaku_won, best_waves, dan_cleared, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, JSON.stringify([]), 1, -1, 1)
      .run();
    expect((await me(user)).characters).toEqual(['speed']);
    const row = await env.DB.prepare('SELECT characters FROM progress WHERE account_id = ?').bind(user.id).first<{ characters: string }>();
    expect(JSON.parse(row!.characters)).toEqual(['speed']);
  });

  it('解禁は減らない（記録の悪いランのあとも残る）。雀士の一覧がない前の行は、条件を満たした雀士を解禁済みにする', async () => {
    const user = await newUser();
    // characters の列がない（NULL の）前の行。南場まで突破しているので、うさぎとぞうを選べていた。読むと一覧を書き戻す
    await env.DB.prepare('INSERT INTO progress (account_id, yaku_won, best_waves, dan_cleared, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, JSON.stringify(['プチ国士']), 4, 2, 1)
      .run();
    const { res } = await playRun(user, { character: 'oya', dan: 3 });
    expect(res.status).toBe(200);
    const p = await me(user);
    expect(p.yakuWon).toContain('プチ国士');
    expect(p.bestWaves).toBe(4);
    expect(p.danCleared).toBeGreaterThanOrEqual(2);
    expect([...p.yakuWon].sort()).toEqual(p.yakuWon);
    expect(p.characters).toEqual(expect.arrayContaining(['speed', 'oya']));
    // 書き戻した行には一覧が入る
    const row = await env.DB.prepare('SELECT characters FROM progress WHERE account_id = ?').bind(user.id).first<{ characters: string }>();
    expect(JSON.parse(row!.characters)).toEqual(expect.arrayContaining(['speed', 'oya']));
  });
});

describe('週ごとのランキング', () => {
  /** 倍率 ×1 のお題 1 つの記録（合計点と記録点が同じになる） */
  const missionsOf = (met: boolean) => [{ ...makeMission('wins', 2, 1), met }];
  async function putBest(name: string | undefined, cleared: boolean, record: number, dan = 0) {
    const user = await newUser({ name });
    await env.DB.prepare(
      `INSERT INTO weekly_best (week, account_id, run_id, dan, missions, cleared, total_score, record_score, waves_cleared, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
      .bind(weekOf(Date.now()), user.id, crypto.randomUUID(), dan, JSON.stringify(missionsOf(cleared)), Number(cleared), record, record, Date.now())
      .run();
    return user;
  }

  it('段位が高いほうが上（クリアしたかより先に比べる）', async () => {
    const a = await putBest('雀士A', true, 50000, 0);
    await putBest('雀士B', false, 500, 2);
    const ranking = (await (await get('/api/rankings/weekly', a)).json()) as {
      entries: { rank: number; name: string; dan: number }[];
      me: { rank: number };
    };
    expect(ranking.entries.map((e) => [e.rank, e.name, e.dan])).toEqual([
      [1, '雀士B', 2],
      [2, '雀士A', 0],
    ]);
    expect(ranking.me.rank).toBe(2);
  });

  it('クリアしたか → 記録点の順。同じ成績は同じ順位。名前のない ID は載らないが本人には成績を返す', async () => {
    const a = await putBest('雀士A', false, 3000);
    await putBest('雀士B', true, 1000);
    await putBest('雀士C', false, 3000);
    await putBest('雀士D', false, 2000);
    const anon = await putBest(undefined, true, 99999);

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

    const mine = (await (await get('/api/rankings/weekly', anon)).json()) as { me: unknown };
    expect(mine.me).toEqual({
      rank: null,
      dan: 0,
      character: 'standard',
      missions: missionsOf(true),
      cleared: true,
      times: 1,
      totalScore: 99999,
      recordScore: 99999,
    });
  });

  it('4 場の形で記録した行は、お題なしで、段位によらず東風戦の記録の下に並び、東風戦で記録すれば置き換わる', async () => {
    const legacy = async (name: string, dan: number) => {
      const user = await newUser({ name });
      await env.DB.prepare(
        'INSERT INTO weekly_best (week, account_id, run_id, dan, waves_cleared, total_score, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(weekOf(Date.now()), user.id, crypto.randomUUID(), dan, 4, 50000, Date.now())
        .run();
      return user;
    };
    const old = await legacy('雀士A', 4);
    await putBest('雀士B', false, -300, 0);
    const ranking = (await (await get('/api/rankings/weekly', old)).json()) as { entries: { name: string }[] };
    expect(ranking.entries.map((e) => e.name)).toEqual(['雀士B', '雀士A']);
    expect(ranking.entries[1]).toMatchObject({ missions: null, cleared: false, totalScore: 50000, recordScore: 0 });
    // 同じ ID が東風戦で記録すると、段位が低くても置き換わる
    const replaced = await legacy('雀士C', 5);
    const { res } = await playRun(replaced);
    expect(((await res.json()) as { best: boolean }).best).toBe(true);
    const row = await env.DB.prepare('SELECT missions FROM weekly_best WHERE account_id = ?').bind(replaced.id).first<{ missions: string | null }>();
    expect(row?.missions).not.toBeNull();
  });

  it('週は月曜の日付で指定する', async () => {
    const user = await newUser();
    expect((await get('/api/rankings/weekly?week=2026-10-27', user)).status).toBe(400); // 火曜
    expect((await get('/api/rankings/weekly?week=2026-10-26', user)).status).toBe(200);
  });
});

describe('感想', () => {
  const context = {
    runId: null,
    character: 'standard',
    dan: 0,
    kyoku: 1,
    missions: '×1 和了 2 回（済）・×1.5 合計 6,000 点以上・×2 清一色で和了る',
    finished: false,
    cleared: null,
    score: 1200,
    engineVersion: 2,
    appVersion: '0.0.1+abc',
  };

  it('本文とランの様子を残す', async () => {
    const user = await newUser();
    const res = await post('/api/feedback', user, { body: '  役満が出ない  ', context });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT * FROM feedback WHERE account_id = ?').bind(user.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      body: '役満が出ない',
      character: 'standard',
      dan: 0,
      kyoku: 1,
      missions: context.missions,
      finished: 0,
      cleared: null,
      wave: null,
      score: 1200,
      app_version: '0.0.1+abc',
    });
    const done = await post('/api/feedback', user, { body: '終わった', context: { ...context, finished: true, cleared: true, kyoku: 4 } });
    expect(done.status).toBe(201);
    const last = await env.DB.prepare('SELECT cleared FROM feedback WHERE body = ?').bind('終わった').first<{ cleared: number }>();
    expect(last?.cleared).toBe(1);
    // ランの様子はなくてもよい
    expect((await post('/api/feedback', user, { body: '楽しい' })).status).toBe(201);
  });

  it('空・長すぎる本文、形の違うランの様子は 400', async () => {
    const user = await newUser();
    for (const body of [{ body: '   ' }, { body: 'あ'.repeat(1001) }, { body: 'x', context: { dan: 'x' } }, {}]) {
      expect((await post('/api/feedback', user, body)).status).toBe(400);
    }
    expect((await post('/api/feedback', user, { body: 'あ'.repeat(1000) })).status).toBe(201);
  });

  it('1 時間に 5 件まで（ID ごと）', async () => {
    const user = await newUser();
    for (let i = 0; i < 5; i++) expect((await post('/api/feedback', user, { body: `${i}` })).status).toBe(201);
    expect((await post('/api/feedback', user, { body: '6' })).status).toBe(429);
    // ほかの ID は数えない
    expect((await post('/api/feedback', await newUser(), { body: '別の人' })).status).toBe(201);
    // 1 時間より前のものは数えない
    await env.DB.prepare('UPDATE feedback SET created_at = ? WHERE account_id = ?').bind(1, user.id).run();
    expect((await post('/api/feedback', user, { body: '7' })).status).toBe(201);
  });
});

describe('退会（GameService.deleteAccount）', () => {
  it('記録を消し、以後その ID の要求を断る。何度呼んでもよい', async () => {
    const user = await newUser({ name: '雀士A' });
    await playRun(user);
    await post('/api/feedback', user, { body: '感想' });
    const service = new GameService({} as never, env as never);
    await service.deleteAccount(user.id);
    await service.deleteAccount(user.id);
    for (const [table] of ACCOUNT_TABLES) {
      const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`).bind(user.id).first<{ n: number }>();
      expect(left?.n).toBe(0);
    }
    expect((await post('/api/runs', user)).status).toBe(410);
  });
});
