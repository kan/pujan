import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, apply, createGame, isFinished, newLog, replay, type GameAction, type GameState, type RunLog } from '../src/game.js';
import { EXTEND_PRICE, EXTEND_TURNS, GACHA, SELL_PRICES } from '../src/items.js';
import { turnLimit, type KyokuResult } from '../src/kyoku.js';
import { YAKUMAN_MARK, makeMission, missionLabel, missionMet, type Mission } from '../src/mission.js';
import { createRng, mix32 } from '../src/rng.js';
import {
  KYOKU_COUNT,
  buyBlocker,
  canGacha,
  canModify,
  createRun,
  gachaRefund,
  interestFor,
  leaveShop,
  orasuNeed,
  runSummary,
  settleKyoku,
  type RunState,
} from '../src/run.js';
import { botAction } from '../src/sim.js';
import { KIND_COUNT } from '../src/tiles.js';

/** 点数だけを決めた和了の結果（精算のテスト用）。yaku は役の名前 */
function winResult(points: number, gold = 0, yaku: string[] = [], yakuman = 0): KyokuResult {
  return {
    type: 'win',
    gold,
    score: { points, lines: [] },
    ura: [],
    win: {
      evaluation: { yakuman, han: 0, yaku: yaku.map((name) => ({ name, han: 1 })), noYaku: !yaku.length },
      tileIds: [],
      kinds: [],
      jokers: [],
      points,
    },
  } as unknown as KyokuResult;
}

const DRAW: KyokuResult = { type: 'draw', tenpai: false, fee: 0, penalty: 0, stickLost: 0 };

/**
 * AI に 1 ランを遊ばせ、操作ログを残す。ショップでは買えるものを買い、
 * 牌の改造は最初に選べる牌に使う。gacha なら、ショップで福引きを回せるときは先に回す
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

/** ランを始めたところ（最初のショップが開いている） */
const shopGame = (seed = 3): GameState => createGame(seed);

/** 最初のショップを出て、東 1 局が始まったところ */
const firstKyoku = (seed: number): GameState => apply(shopGame(seed), { type: 'leave' });

/** お題を決めたラン（精算のテスト用）。親は東 1 局 */
function runWith(missions: Mission | Mission[], dan = 0): RunState {
  const run = createRun(1, { start: { character: 'standard', dan, unlockedYaku: [] } });
  return { ...run, phase: 'kyoku', shop: null, afterShop: null, missions: [missions].flat(), round: { ...run.round, dealer: 0 } };
}

/** オーラス（東 4 局）まで進めたラン */
const atOrasu = (run: RunState, score = 0, wins = 0): RunState => ({ ...run, round: { ...run.round, kyoku: 3, score, wins } });

describe('操作ログと再生', () => {
  // 3 ランを遊んで再生するので、ほかのテストと並んで走ると 5 秒を超えることがある
  it('ログを再生すると同じ最後の状態になる', { timeout: 20_000 }, () => {
    for (const seed of [1, 2, 3]) {
      const { log, final } = playLogged(seed);
      expect(isFinished(final)).toBe(true);
      expect(replay(log)).toEqual(final);
    }
  });

  it('終わったランの成績（お題・クリアしたか・倍率・合計点・記録点）', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { run } = playLogged(seed).final;
      const s = runSummary(run);
      expect(s.missions.map(({ met: _met, ...m }) => m)).toEqual(run.missions);
      expect(s.cleared).toBe(run.phase === 'cleared');
      expect(s.totalScore).toBe(run.round.score);
      const times = s.missions.filter((m) => m.met).reduce((a, m) => a + m.times, 0);
      expect(s.times).toBe(s.cleared ? times : 1);
      expect(s.recordScore).toBe(Math.round(s.totalScore * s.times));
      expect(run.round.kyoku).toBe(KYOKU_COUNT - 1);
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
    const actions = [1, 2, 3, 11, 12, 13].flatMap((seed) => playLogged(seed).log.actions);
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
    const g = firstKyoku(1);
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
    const g = shopGame();
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
    const g = shopGame();
    const owns = { ...g, run: { ...g.run, money: 0, charms: ['chokin' as const], consumables: ['tsumo' as const, 'hiroi' as const] } };
    const charmSold = apply(owns, { type: 'sell', index: 0 });
    expect(charmSold.run).toMatchObject({ charms: [], money: SELL_PRICES.charm });
    const consumableSold = apply(owns, { type: 'sellConsumable', index: 1 });
    expect(consumableSold.run).toMatchObject({ consumables: ['tsumo'], money: SELL_PRICES.consumable });
  });

  it('消耗品の枠がいっぱいでも、売れば買える', () => {
    const g = shopGame();
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
      // はずれは GACHA.missRate（5 割）ほど
      expect(misses / 200).toBeGreaterThan(GACHA.missRate - 0.1);
      expect(misses / 200).toBeLessThan(GACHA.missRate + 0.1);
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
      const run = runWith(makeMission('wins', 5, 2), 5);
      expect(settleKyoku({ ...run, round: { ...run.round, kyoku: 1 } }, winResult(1000, 1)).gachaTickets).toBe(0);
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

    it('金牌で和了ると福引き券をもらう（東 4 局ではもらわない）。ショップを開くと回した結果は消える', () => {
      const run = runWith(makeMission('wins', 1, 1));
      const afterWin = settleKyoku({ ...run, round: { ...run.round, kyoku: 1 }, gacha: { prize: null, ticket: false } }, winResult(0, 1));
      expect(afterWin.gachaTickets).toBe(1);
      expect(afterWin.gacha).toBeNull();
      expect(settleKyoku(atOrasu(run), winResult(0, 1)).gachaTickets).toBe(0);
    });
  });

  it('祝儀を払って最終巡で巡を延ばせる。延長札と合わせて 1 局に 1 回まで', () => {
    let g = firstKyoku(4);
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

describe('ランの流れ（東風戦）', () => {
  it('最初のショップから始まり、出ると東 1 局', () => {
    const g = createGame(1);
    expect(g.run).toMatchObject({ phase: 'shop', afterShop: 'firstKyoku', interest: 0 });
    expect(g.run.shop).toHaveLength(3);
    expect(g.kyoku).toBeNull();
    const k = apply(g, { type: 'leave' });
    expect(k.run.phase).toBe('kyoku');
    expect(k.run.round.kyoku).toBe(0);
    expect(k.kyoku).not.toBeNull();
  });

  it('東 1〜3 局のあとは利子をもらってショップ、東 4 局のあとはランが終わる', () => {
    const run = { ...runWith(makeMission('points', 1, 1)), money: 12 };
    const shop = settleKyoku(run, DRAW);
    expect(shop.phase).toBe('shop');
    expect(shop.interest).toBe(interestFor(12));
    expect(interestFor(12)).toBe(2);
    expect(interestFor(100)).toBe(3);
    expect(shop.money).toBe(12 + 2);
    expect(leaveShop(shop).round.kyoku).toBe(1);
    const over = settleKyoku(atOrasu(run), DRAW);
    expect(over.phase).toBe('over');
    expect(over.shop).toBeNull();
  });

  it('お題を果たしていれば東 4 局のあとにクリア、早く果たしても東 4 局まで続く', () => {
    const run = runWith(makeMission('wins', 1, 1));
    const one = settleKyoku({ ...run, round: { ...run.round, dealer: 3 } }, winResult(1000));
    const two = settleKyoku(leaveShop(one), winResult(1000));
    expect(two.round.wins).toBe(2);
    expect(two.phase).toBe('shop');
    expect(settleKyoku(atOrasu(two, two.round.score, 2), DRAW).phase).toBe('cleared');
  });

  it('お題を 1 つ以上果たせばクリア。記録点は、果たしたお題の倍率の合計を掛ける（クリアしなければ掛けない）', () => {
    const missions = [makeMission('wins', 1, 1), makeMission('points', 2, 1.5), makeMission('yaku', 3, 2, '清一色')];
    const run = runWith(missions);
    // 点数のお題だけ: ×1.5
    const points = runSummary(settleKyoku(atOrasu(run, 5900), winResult(300)));
    expect(points).toMatchObject({ cleared: true, times: 1.5, totalScore: 6200, recordScore: 9300 });
    expect(points.missions.map((m) => m.met)).toEqual([false, true, false]);
    // 回数と点数: ×2.5、3 つとも: ×4.5
    expect(runSummary(settleKyoku(atOrasu(run, 5900, 1), winResult(300))).times).toBe(2.5);
    expect(runSummary(settleKyoku(atOrasu(run, 5900, 1), winResult(300, 0, ['清一色']))).times).toBe(4.5);
    // 1 つも果たさなければ未達で、倍率は掛けない
    const over = runSummary(settleKyoku(atOrasu(run, 5000), winResult(300)));
    expect(over).toMatchObject({ cleared: false, times: 1, totalScore: 5300, recordScore: 5300 });
  });

  it('連荘の和了も回数に数え、オーラスの親の連荘が途切れたところでランが終わる', () => {
    const run = runWith(makeMission('wins', 1, 1));
    const dealerOrasu = { ...atOrasu(run), round: { ...atOrasu(run).round, dealer: 3 } };
    const first = settleKyoku(dealerOrasu, winResult(1000), true);
    expect(first.phase).toBe('kyoku');
    expect(first.round.honba).toBe(1);
    const second = settleKyoku(first, winResult(1000), true);
    expect(second.round.wins).toBe(2);
    expect(settleKyoku(second, DRAW).phase).toBe('cleared');
  });
});

describe('お題', () => {
  it('お題は枠ごとに倍率と段が決まり、種類は重ならない。段位で段が上がる（5 まで）', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const [dan, tiers, times] of [
        [0, [1, 2, 3], [1, 1.5, 2]],
        [1, [2, 3, 4], [1, 1.5, 2]],
        [4, [3, 4, 5], [1, 1.5, 2]],
        [5, [4, 5], [1.5, 2]],
      ] as const) {
        const { missions } = createRun(seed, { start: { character: 'standard', dan, unlockedYaku: [] } });
        expect(missions.map((m) => m.tier)).toEqual(tiers);
        expect(missions.map((m) => m.times)).toEqual(times);
        expect(new Set(missions.map((m) => m.kind)).size).toBe(missions.length);
      }
    }
  });

  it('同じシードなら同じお題で、シードが違えば種類も役も散らばる', () => {
    expect(createRun(5).missions).toEqual(createRun(5).missions);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) for (const m of createRun(seed).missions) seen.add(missionLabel(m));
    expect([...seen]).toEqual(expect.arrayContaining(['和了 2 回', '和了 3 回', '和了 4 回', '合計 3,000 点以上', '合計 12,000 点以上']));
    expect([...seen].filter((l) => l.endsWith('で和了る')).length).toBeGreaterThan(4);
  });

  it('お題の判定（回数・点数・役。役満の段はどの役満でもよい）', () => {
    const p = (wins: number, points: number, yakuWon: string[] = []) => ({ wins, points, yakuWon });
    expect(missionMet(makeMission('wins', 2, 1), p(3, 0))).toBe(true);
    expect(missionMet(makeMission('wins', 2, 1), p(2, 99999))).toBe(false);
    expect(missionMet(makeMission('points', 1, 1), p(0, 3000))).toBe(true);
    expect(missionMet(makeMission('points', 1, 1), p(9, 2900))).toBe(false);
    expect(missionMet(makeMission('yaku', 2, 1, '混一色'), p(1, 0, ['混一色', 'ドラ']))).toBe(true);
    expect(missionMet(makeMission('yaku', 2, 1, '混一色'), p(1, 0, ['清一色']))).toBe(false);
    expect(missionMet(makeMission('yaku', 5, 1, YAKUMAN_MARK), p(1, 0, ['字一色', YAKUMAN_MARK]))).toBe(true);
    expect(() => makeMission('yaku', 1, 1, '清一色')).toThrow();
  });

  it('役のお題は、その役を含む和了で果たす', () => {
    const run = runWith(makeMission('yaku', 2, 1.5, '混一色'));
    const missed = settleKyoku(atOrasu(run), winResult(800, 0, ['清一色']));
    expect(missed.phase).toBe('over');
    const hit = settleKyoku(atOrasu(run), winResult(800, 0, ['混一色', '役牌']));
    expect(hit.phase).toBe('cleared');
    const yakuman = runWith(makeMission('yaku', 5, 2, YAKUMAN_MARK));
    expect(settleKyoku(atOrasu(yakuman), winResult(8000, 0, ['字一色'], 1)).phase).toBe('cleared');
  });
});

describe('オーラスの和了（段位の縛り。GitHub issue #9）', () => {
  it('五段からはオーラスで和了らないとクリアにならず、雀聖は 2,000 点以上の和了が要る', () => {
    const m = makeMission('points', 1, 1);
    for (const dan of [0, 1, 2, 3]) expect(orasuNeed(runWith(m, dan))).toBeNull();
    expect(orasuNeed(runWith(m, 4))).toBe(1);
    expect(orasuNeed(runWith(m, 5))).toBe(2000);

    expect(settleKyoku(atOrasu(runWith(m, 3), 99999), DRAW).phase).toBe('cleared');
    expect(settleKyoku(atOrasu(runWith(m, 4), 99999), DRAW).phase).toBe('over');
    expect(settleKyoku(atOrasu(runWith(m, 4), 99999), winResult(100)).phase).toBe('cleared');
    expect(settleKyoku(atOrasu(runWith(m, 5), 99999), winResult(1900)).phase).toBe('over');
    expect(settleKyoku(atOrasu(runWith(m, 5), 99999), winResult(2000)).phase).toBe('cleared');
    // オーラスで和了っても、お題を果たしていなければクリアにならない
    expect(settleKyoku(atOrasu(runWith(m, 4), 0), winResult(100)).phase).toBe('over');
  });

  it('連荘の前の和了で条件を満たしていれば、連荘の局が流局でもクリアになる', () => {
    const base = atOrasu(runWith(makeMission('points', 1, 1), 5), 99999);
    const dealerOrasu = { ...base, round: { ...base.round, dealer: 3 } };
    const renchan = settleKyoku(dealerOrasu, winResult(2400), true);
    expect(renchan.phase).toBe('kyoku');
    expect(renchan.round.orasuWin).toBe(2400);
    expect(settleKyoku(renchan, DRAW).phase).toBe('cleared');
  });
});
