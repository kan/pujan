import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, apply, createGame, isFinished, newLog, replay, type GameAction, type GameState, type RunLog } from '../src/game.js';
import { canModify, runSummary } from '../src/run.js';
import { botAction } from '../src/sim.js';
import { KIND_COUNT } from '../src/tiles.js';

/** AI に 1 ランを遊ばせ、操作ログを残す。ショップでは買えるものを買い、牌の改造は最初に選べる牌に使う */
function playLogged(seed: number, maxActions = 5000): { log: RunLog; final: GameState } {
  const log = newLog(seed);
  let g = createGame(seed);
  const act = (a: GameAction) => {
    g = apply(g, a);
    log.actions.push(a);
  };
  while (!isFinished(g) && log.actions.length < maxActions) {
    const { run, kyoku } = g;
    if (kyoku && !kyoku.result) {
      // 消耗品は持っていれば使ってみる（使えないときは局の操作に進む）
      const usable = run.consumables.findIndex((id) => id !== 'irekae');
      if (usable >= 0 && kyoku.turn === 2 && !kyoku.riichi) {
        try {
          act({ type: 'useConsumable', index: usable });
          continue;
        } catch {
          // 使えない状況なら使わない
        }
      }
      act(botAction(kyoku, { target: '和了形', riichi: true }));
    } else if (kyoku) {
      act({ type: 'settle', renchan: true });
    } else {
      const i = run.shop!.findIndex((o) => !o.sold && o.price <= run.money);
      const o = run.shop![i];
      if (o && run.charms.length < 5 && run.consumables.length < 2) {
        const target = o.kind === 'mod' ? [...Array(KIND_COUNT).keys()].find((k) => canModify(run.composition, o.id, k)) : undefined;
        act({ type: 'buy', index: i, target });
      } else {
        act({ type: 'leave' });
      }
    }
  }
  return { log, final: g };
}

describe('操作ログと再生', () => {
  it('ログを再生すると同じ最後の状態になる', () => {
    for (const seed of [1, 2, 3]) {
      const { log, final } = playLogged(seed);
      expect(isFinished(final)).toBe(true);
      expect(replay(log)).toEqual(final);
    }
  });

  it('終わったランの成績（突破した場の数と合計点）', () => {
    for (const seed of [1, 2, 3]) {
      const { run } = playLogged(seed).final;
      const s = runSummary(run);
      // 突破できなかった最後の場も合計に入る
      expect(run.waveScores).toHaveLength(run.phase === 'cleared' ? 4 : s.wavesCleared + 1);
      expect(s.totalScore).toBe(run.waveScores.reduce((a, b) => a + b, 0));
      expect(s.wavesCleared).toBe(run.phase === 'cleared' ? 4 : run.wave);
    }
    expect(() => runSummary(createGame(1).run)).toThrow(/not finished/);
  });

  it('JSON にしても同じに再生できる', () => {
    const { log, final } = playLogged(11);
    const restored = JSON.parse(JSON.stringify(log)) as RunLog;
    expect(replay(restored).run).toEqual(final.run);
  });

  it('途中のランも再生できる', () => {
    const { log } = playLogged(4);
    const half = { ...log, actions: log.actions.slice(0, Math.floor(log.actions.length / 2)) };
    const g = replay(half);
    expect(isFinished(g)).toBe(false);
  });

  it('買い物や牌の改造を含むランがある', () => {
    const actions = [1, 2, 3, 11].flatMap((seed) => playLogged(seed).log.actions);
    const kinds = new Set(actions.map((a) => a.type));
    expect([...kinds]).toEqual(expect.arrayContaining(['discard', 'hold', 'tsumo', 'settle', 'buy', 'leave', 'useConsumable']));
    // 牌の改造（対象の種類つきの買い物）
    expect(actions.some((a) => a.type === 'buy' && a.target !== undefined)).toBe(true);
  });

  it('できない操作が混じったログは、何番目の操作かを示して失敗する', () => {
    const { log } = playLogged(5);
    const bad: RunLog = { ...log, actions: [...log.actions.slice(0, 3), { type: 'reroll' }, ...log.actions.slice(3)] };
    expect(() => replay(bad)).toThrow(/action 3 \(reroll\)/);
  });

  it('枠や番号を偽った操作は拒む', () => {
    const g = createGame(1);
    const bad: unknown[] = [
      { type: 'hold', zone: 'drawn', index: 0, slot: 7 },
      { type: 'hold', zone: 'drawn', index: 0, slot: 0.5 },
      { type: 'hold', zone: 'hold', index: 0, slot: 0 },
      { type: 'discard', zone: 'hand', index: 'length' },
      { type: 'discard', zone: 'river', index: 0 },
      { type: 'consumable', id: 'tsumo' },
      { type: 'useConsumable', index: 'length' },
      { type: 'sell', index: 'length' },
      { type: 'foo' },
    ];
    for (const a of bad) expect(() => apply(g, a as GameAction), JSON.stringify(a)).toThrow();
  });

  it('ショップの番号と牌の改造の対象を偽った操作は拒む', () => {
    // ショップが開くまで進める
    let g = createGame(3);
    while (g.kyoku) g = apply(g, g.kyoku.result ? { type: 'settle' } : botAction(g.kyoku, { target: '和了形' }));
    expect(g.run.phase).toBe('shop');
    const rich = { ...g, run: { ...g.run, money: 99, charms: ['chokin' as const] } };
    for (const a of [
      { type: 'buy', index: 'length' },
      { type: 'buy', index: -1 },
      { type: 'sell', index: 'length' },
    ]) {
      expect(() => apply(rich, a as GameAction), JSON.stringify(a)).toThrow();
    }
    const modShop = { ...rich, run: { ...rich.run, shop: [{ kind: 'mod' as const, id: 'nuki' as const, price: 3, sold: false }] } };
    for (const target of ['length', 34, -1, 1.5]) {
      expect(() => apply(modShop, { type: 'buy', index: 0, target: target as number }), String(target)).toThrow();
    }
    expect(apply(modShop, { type: 'buy', index: 0, target: 0 }).run.composition.count[0]).toBe(0);
  });

  it('版の違うログは再生しない', () => {
    const { log } = playLogged(7, 10);
    expect(() => replay({ ...log, engineVersion: ENGINE_VERSION + 1 })).toThrow(/engine version/);
  });

  it('終わったランには操作できない', () => {
    const { final } = playLogged(8);
    expect(() => apply(final, { type: 'leave' })).toThrow(/finished/);
  });
});
