import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, apply, createGame, isFinished, newLog, replay, type GameAction, type RunLog } from '../src/game.js';
import { MAX_CHARMS } from '../src/items.js';
import { DEFAULT_START } from '../src/progression.js';
import { canGacha, runSummary } from '../src/run.js';
import { botAction } from '../src/sim.js';
import { aggregate, analyzeRun } from '../src/stats.js';

/** AI に遊ばせた操作ログ。ショップでは買えるお守りか設備を 1 つ買い、ときどき品替えする */
function playedLog(seed: number, maxActions = Infinity): RunLog {
  const log = newLog(seed, { ...DEFAULT_START, unlockedYaku: ['役牌'] });
  let g = createGame(seed, { start: log.start });
  const act = (a: GameAction) => {
    g = apply(g, a);
    log.actions.push(a);
  };
  let rerolled = false;
  while (!isFinished(g) && log.actions.length < maxActions) {
    if (g.kyoku && !g.kyoku.result) act(botAction(g.kyoku, { target: '和了形', riichi: true }));
    else if (g.kyoku) {
      act({ type: 'settle', renchan: true });
      rerolled = false;
    } else if (canGacha(g.run)) {
      act({ type: 'gacha' });
    } else {
      const i = g.run.shop!.findIndex((o) => !o.sold && o.price <= g.run.money && (o.kind === 'charm' || o.kind === 'equip'));
      if (i >= 0 && g.run.charms.length < MAX_CHARMS) act({ type: 'buy', index: i });
      else if (!rerolled && g.run.money >= 6) {
        act({ type: 'reroll' });
        rerolled = true;
      } else act({ type: 'leave' });
    }
  }
  return log;
}

describe('プレイの集計', () => {
  it('1 つのランから、局・和了・役・ショップ・負けた場を数える', () => {
    const log = playedLog(3);
    const s = analyzeRun(log)!;
    expect(s.start).toBe('くま・初段');
    expect(s.kyoku).toBe(log.actions.filter((a) => a.type === 'settle').length);
    expect(s.wins).toBeGreaterThan(0);
    expect(s.yaku.length).toBeGreaterThanOrEqual(s.wins);
    expect(s.bought.length).toBe(log.actions.filter((a) => a.type === 'buy').length);
    // ショップを開くたびと品替えのたびに 3 品並ぶ（買っても並び直さない）
    expect(s.shown.length % 3).toBe(0);
    expect(s.shown.length / 3).toBeGreaterThan(log.actions.filter((a) => a.type === 'reroll').length);
    for (const b of s.bought) expect(s.shown).toContain(b);
    // 福引きは回した回数ぶん、景品かはずれを数える
    expect(s.gacha?.length).toBe(log.actions.filter((a) => a.type === 'gacha').length);
    expect(s.gacha?.length).toBeGreaterThan(0);
    // ラン終了なら負けた場のボスが分かる
    expect(s.lostBoss === null).toBe(s.wavesCleared === 4);
  });

  it('終わっていない・版が違う・再生できない・始めの条件の形が違うログは null', () => {
    expect(analyzeRun(playedLog(4, 30))).toBeNull();
    expect(analyzeRun({ ...playedLog(4), start: { ...DEFAULT_START, dan: 99 } })).toBeNull();
    expect(analyzeRun({ ...playedLog(4, 5), engineVersion: ENGINE_VERSION + 1 })).toBeNull();
    expect(analyzeRun({ ...newLog(1), actions: [{ type: 'leave' }] })).toBeNull();
  });

  it('ランを合計する', { timeout: 30_000 }, () => {
    const logs = [1, 2].map((seed) => playedLog(seed));
    const runs = logs.map((l) => analyzeRun(l)!);
    const total = aggregate(runs);
    expect(total.runs).toBe(2);
    expect(total.byStart['くま・初段'].runs).toBe(2);
    const summaries = logs.map((l) => runSummary(replay(l).run));
    expect(total.byStart['くま・初段'].waves).toBe(summaries.reduce((a, s) => a + s.wavesCleared, 0));
    expect(total.lostAt.reduce((a, n) => a + n, 0) + total.byStart['くま・初段'].cleared).toBe(2);
    expect(total.kyoku).toBe(runs.reduce((a, r) => a + r.kyoku, 0));
    const bought = Object.values(total.shop).reduce((a, s) => a + s.bought, 0);
    expect(bought).toBe(runs.reduce((a, r) => a + r.bought.length, 0));
    const gacha = Object.values(total.gacha).reduce((a, n) => a + n, 0);
    expect(gacha).toBe(runs.reduce((a, r) => a + (r.gacha?.length ?? 0), 0));
    // 福引きを足す前に記録したラン（gacha の欄がない）も合計できる
    const { gacha: _omit, ...old } = runs[0];
    void _omit;
    expect(aggregate([old]).gacha).toEqual({});
  });
});
