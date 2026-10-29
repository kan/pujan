import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, apply, createGame, isFinished, newLog, replay, type GameAction, type GameState, type RunLog } from '../src/game.js';
import { EXTEND_PRICE, EXTEND_TURNS, GACHA, SELL_PRICES } from '../src/items.js';
import { turnLimit, type KyokuResult } from '../src/kyoku.js';
import { createRng, mix32 } from '../src/rng.js';
import { buyBlocker, canGacha, canModify, createRun, gachaRefund, runSummary, settleKyoku } from '../src/run.js';
import { botAction } from '../src/sim.js';
import { KIND_COUNT } from '../src/tiles.js';

/**
 * AI に 1 ランを遊ばせ、操作ログを残す。ショップでは買えるものを買い、牌の改造は最初に選べる牌に使う。
 * gacha なら、ショップで福引きを回せるときは先に回す
 */
function playLogged(seed: number, maxActions = 5000, gacha = false): { log: RunLog; final: GameState } {
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
    } else if (gacha && canGacha(run)) {
      act({ type: 'gacha' });
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
  // 3 ランを遊んで再生するので、ほかのテストと並んで走ると 5 秒を超えることがある
  it('ログを再生すると同じ最後の状態になる', { timeout: 20_000 }, () => {
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
      { type: 'sellConsumable', index: 0 },
      { type: 'foo' },
    ];
    for (const a of bad) expect(() => apply(g, a as GameAction), JSON.stringify(a)).toThrow();
  });

  it('ショップの番号と牌の改造の対象を偽った操作は拒む', () => {
    // ショップが開くまで進める
    let g = createGame(3);
    while (g.kyoku) g = apply(g, g.kyoku.result ? { type: 'settle' } : botAction(g.kyoku, { target: '和了形' }));
    expect(g.run.phase).toBe('shop');
    const rich = { ...g, run: { ...g.run, money: 99, charms: ['chokin' as const], consumables: ['tsumo' as const] } };
    for (const a of [
      { type: 'buy', index: 'length' },
      { type: 'buy', index: -1 },
      { type: 'sell', index: 'length' },
      { type: 'sellConsumable', index: 'length' },
      { type: 'sellConsumable', index: 1 },
    ]) {
      expect(() => apply(rich, a as GameAction), JSON.stringify(a)).toThrow();
    }
    const modShop = { ...rich, run: { ...rich.run, shop: [{ kind: 'mod' as const, id: 'nuki' as const, price: 3, sold: false }] } };
    for (const target of ['length', 34, -1, 1.5]) {
      expect(() => apply(modShop, { type: 'buy', index: 0, target: target as number }), String(target)).toThrow();
    }
    expect(apply(modShop, { type: 'buy', index: 0, target: 0 }).run.composition.count[0]).toBe(0);
  });

  it('ショップでお守りと消耗品を売ると、枠が空いて祝儀が増える', () => {
    let g = createGame(3);
    while (g.kyoku) g = apply(g, g.kyoku.result ? { type: 'settle' } : botAction(g.kyoku, { target: '和了形' }));
    const owns = { ...g, run: { ...g.run, money: 0, charms: ['chokin' as const], consumables: ['tsumo' as const, 'hiroi' as const] } };
    const charmSold = apply(owns, { type: 'sell', index: 0 });
    expect(charmSold.run).toMatchObject({ charms: [], money: SELL_PRICES.charm });
    const consumableSold = apply(owns, { type: 'sellConsumable', index: 1 });
    expect(consumableSold.run).toMatchObject({ consumables: ['tsumo'], money: SELL_PRICES.consumable });
  });

  it('消耗品の枠がいっぱいでも、売れば買える', () => {
    let g = createGame(3);
    while (g.kyoku) g = apply(g, g.kyoku.result ? { type: 'settle' } : botAction(g.kyoku, { target: '和了形' }));
    const offer = { kind: 'consumable' as const, id: 'nozoki' as const, price: 3, sold: false };
    const full = { ...g, run: { ...g.run, money: 99, consumables: ['tsumo' as const, 'hiroi' as const], shop: [offer] } };
    expect(buyBlocker(full.run, 0)).toBe('consumablesFull');
    const sold = apply(full, { type: 'sellConsumable', index: 0 });
    expect(buyBlocker(sold.run, 0)).toBeNull();
    expect(apply(sold, { type: 'buy', index: 0 }).run.consumables).toEqual(['hiroi', 'nozoki']);
  });

  describe('福引き', () => {
    it('福引きを含むログを再生すると同じ最後の状態になる', { timeout: 20_000 }, () => {
      const { log, final } = playLogged(1, 5000, true);
      expect(log.actions.some((a) => a.type === 'gacha')).toBe(true);
      expect(replay(log)).toEqual(final);
    });

    function shopGame(): GameState {
      let g = createGame(3);
      while (g.kyoku) g = apply(g, g.kyoku.result ? { type: 'settle' } : botAction(g.kyoku, { target: '和了形' }));
      return g;
    }

    it('祝儀を払って回し、当たりは持ち物に入る。はずれは祝儀が戻る。ショップごとに 1 回まで', () => {
      const g = shopGame();
      let prizes = 0;
      let misses = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const before = { ...g.run, rng: createRng(mix32(seed)), money: 10, gachaTickets: 0, charms: [], consumables: [] };
        const after = apply({ ...g, run: before }, { type: 'gacha' }).run;
        const result = after.gacha!;
        expect(result.ticket).toBe(false);
        if (result.prize) {
          prizes++;
          expect(after.money).toBe(10 - GACHA.price);
          const owned = after.charms.length + after.consumables.length + after.equipment.length - before.equipment.length;
          const leveled = Object.values(after.yakuLevels).reduce((a, n) => a + n, 0);
          expect(owned + leveled).toBe(1);
        } else {
          misses++;
          expect(after.money).toBe(10 - GACHA.price + GACHA.missRefund);
        }
        expect(canGacha(after)).toBe(false);
        expect(() => apply({ ...g, run: after }, { type: 'gacha' })).toThrow();
      }
      // はずれは 3 割ほど
      expect(misses / 200).toBeGreaterThan(0.2);
      expect(misses / 200).toBeLessThan(0.4);
      expect(prizes).toBeGreaterThan(0);
    });

    it('福引き券があれば祝儀を払わずに回し、はずれでも祝儀は戻らない', () => {
      const g = shopGame();
      for (let seed = 1; seed <= 50; seed++) {
        const after = apply({ ...g, run: { ...g.run, rng: createRng(mix32(seed)), money: 0, gachaTickets: 2 } }, { type: 'gacha' }).run;
        expect(after.gachaTickets).toBe(1);
        expect(after.gacha).toMatchObject({ ticket: true });
        expect(gachaRefund(after.gacha!)).toBe(0);
        expect(after.money).toBe(0);
      }
      expect(canGacha({ ...g.run, money: GACHA.price - 1, gachaTickets: 0 })).toBe(false);
    });

    it('雀聖では福引きを回せず、福引き券ももらえない', () => {
      const g = shopGame();
      const top = { ...g.run, start: { ...g.run.start, dan: 5 }, money: 10, gachaTickets: 1 };
      expect(canGacha(top)).toBe(false);
      expect(canGacha({ ...top, start: { ...top.start, dan: 4 } })).toBe(true);
      const last = { ...createRun(1, { start: { ...g.run.start, dan: 5 } }) };
      const cleared = settleKyoku(
        { ...last, round: { ...last.round, kyoku: 3, score: 999999 } },
        { type: 'draw', tenpai: false, fee: 0, penalty: 0, stickLost: 0 },
      );
      expect(cleared.lastWaveBonus?.tickets).toBe(0);
      expect(cleared.gachaTickets).toBe(0);
    });

    it('受け取れない品は当たらない（枠がいっぱい・持っている・棚に並んでいる）', () => {
      const g = shopGame();
      const charms = ['hayazashi', 'yasude', 'damaten', 'ippatsuya', 'bakuchi'] as const;
      const shelf = [{ kind: 'equip' as const, id: 'hold' as const, price: 8, sold: false }];
      for (let seed = 1; seed <= 300; seed++) {
        const run = { ...g.run, rng: createRng(mix32(seed)), money: 10, charms: [...charms], consumables: ['tsumo' as const, 'hiroi' as const], equipment: ['next' as const], shop: shelf };
        const prize = apply({ ...g, run }, { type: 'gacha' }).run.gacha!.prize;
        expect(prize?.kind ?? 'none').not.toMatch(/charm|consumable/);
        if (prize?.kind === 'equip') expect(['hold', 'next']).not.toContain(prize.id);
      }
    });

    it('場を突破したときと、金牌で和了ったときに福引き券をもらう。ショップを開くと回した結果は消える', () => {
      const run = createRun(1);
      const win = { type: 'win', gold: 1, score: { points: 0, lines: [] }, ura: [], win: { evaluation: { yakuman: 0, han: 0, yaku: [], noYaku: true }, tileIds: [], kinds: [], jokers: [], points: 0 } } as unknown as KyokuResult;
      const afterWin = settleKyoku({ ...run, gacha: { prize: null, ticket: false } }, win);
      expect(afterWin.gachaTickets).toBe(1);
      expect(afterWin.gacha).toBeNull();
      // オーラスで目標を超えて突破する
      const last = { ...run, round: { ...run.round, kyoku: 3, score: 99999 } };
      const cleared = settleKyoku(last, { type: 'draw', tenpai: false, fee: 0, penalty: 0, stickLost: 0 });
      expect(cleared.phase).toBe('shop');
      expect(cleared.gachaTickets).toBe(1);
      expect(cleared.lastWaveBonus?.tickets).toBe(1);
    });
  });

  it('祝儀を払って最終巡で巡を延ばせる。延長札と合わせて 1 局に 1 回まで', () => {
    let g = createGame(4);
    const rich = (x: GameState) => ({ ...x, run: { ...x.run, money: 20 } });
    // 最終巡より前は延ばせない
    expect(() => apply(rich(g), { type: 'extend' })).toThrow();
    while (g.kyoku && !g.kyoku.result && g.kyoku.turn < turnLimit(g.kyoku)) {
      g = apply(g, { type: 'discard', zone: 'drawn', index: 0 });
    }
    expect(g.kyoku?.result).toBeNull();
    // 祝儀が足りなければ延ばせない
    expect(() => apply({ ...g, run: { ...g.run, money: EXTEND_PRICE - 1 } }, { type: 'extend' })).toThrow(/money/);
    const extended = apply(rich(g), { type: 'extend' });
    expect(extended.run.money).toBe(20 - EXTEND_PRICE);
    expect(turnLimit(extended.kyoku!)).toBe(12 + EXTEND_TURNS);
    expect(() => apply(extended, { type: 'extend' })).toThrow();
    // リーチ中も延ばせる。山が尽きていれば延ばせない
    const riichi = { ...rich(g), kyoku: { ...g.kyoku!, riichi: { turn: 5, stick: 100 } } };
    expect(apply(riichi, { type: 'extend' }).run.money).toBe(20 - EXTEND_PRICE);
    expect(() => apply({ ...rich(g), kyoku: { ...g.kyoku!, wall: [] } }, { type: 'extend' })).toThrow();
    // 延長札で延ばしたあとは、祝儀でも延ばせない
    const withTicket = apply({ ...rich(g), run: { ...rich(g).run, consumables: ['encho' as const] } }, { type: 'useConsumable', index: 0 });
    expect(() => apply(withTicket, { type: 'extend' })).toThrow();
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
