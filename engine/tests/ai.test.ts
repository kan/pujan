/**
 * 賢く打つ AI（src/ai.ts。GitHub issue #13）のテスト。
 *
 * 強さそのものは sim で測る（npm run sim -w engine -- starts --ai smart）。ここでは、山の並びを読まないこと、
 * 同じ状態から同じ手を選ぶこと、ランを最後まで遊べること、局とショップの判断の要所を確かめる。
 */
import { describe, expect, it } from 'vitest';
import { smartAction, smartKyokuAction, smartRenchan, smartShopAction } from '../src/ai.js';
import { apply, createGame, isFinished } from '../src/game.js';
import { DEFAULT_BASE_RULES, modifiersFor, type CharmId, type EquipId } from '../src/items.js';
import { defaultComposition, startKyoku, step, type KyokuState, type WallOrder } from '../src/kyoku.js';
import { createRng, mix32, nextInt, shuffle } from '../src/rng.js';
import { canModify, createRun, type Offer, type RunState } from '../src/run.js';
import { botAction, simulateRuns } from '../src/sim.js';
import { EAST, SOUTH, man, pin, sou } from '../src/tiles.js';

function newKyoku(seed: number, loadout: { charms?: CharmId[]; equipment?: EquipId[] } = {}, order?: WallOrder): KyokuState {
  return startKyoku(
    {
      rng: createRng(mix32(seed)),
      composition: defaultComposition(true),
      mods: modifiersFor(DEFAULT_BASE_RULES, { charms: loadout.charms ?? [], equipment: loadout.equipment ?? [] }, null),
      bakaze: EAST,
      seat: SOUTH,
      dealer: false,
      honba: 0,
      yakuLevels: {},
    },
    order,
  );
}

/** 山のうち、ネクストで見えていない部分だけを並べ替えた状態（AI が山の並びを読んでいなければ、同じ手を選ぶ） */
function scrambleHidden(s: KyokuState, seed: number): KyokuState {
  const visible = s.setup.mods.next;
  const hidden = s.wall.slice(0, s.wall.length - visible);
  const [, shuffled] = shuffle(createRng(seed), hidden);
  return { ...s, wall: [...shuffled, ...s.wall.slice(s.wall.length - visible)] };
}

describe('局の手', () => {
  it('山のネクストより先の並びを変えても、同じ手を選ぶ', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 6; seed++) {
      let s = newKyoku(seed);
      for (let guard = 0; guard < 40 && !s.result; guard++) {
        const a = smartKyokuAction(s);
        expect(smartKyokuAction(scrambleHidden(s, seed * 100 + guard))).toEqual(a);
        s = step(s, a as Parameters<typeof step>[1]);
      }
    }
  });

  it('同じ状態からは同じ手を選ぶ', () => {
    const s = newKyoku(3);
    expect(smartKyokuAction(s)).toEqual(smartKyokuAction(s));
  });

  it('役満が和了れるなら和了る', () => {
    // 1 巡目のツモで和了れる（天和）
    const s = newKyoku(1, {}, { indicators: [sou(9)], hand: [man(1), man(2), man(3), pin(5)], draws: [pin(5)] });
    expect(s.win?.evaluation.yakuman).toBeGreaterThan(0);
    expect(smartKyokuAction(s)).toEqual({ type: 'tsumo' });
  });

  it('リーチ中はツモ切りか和了りだけ', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = newKyoku(seed);
      while (!s.result) {
        const a = smartKyokuAction(s);
        if (s.riichi) expect(a.type === 'tsumo' || (a.type === 'discard' && a.zone === 'drawn')).toBe(true);
        s = step(s, a as Parameters<typeof step>[1]);
      }
    }
  });

  it('今の AI（botAction）より 1 局の点数の平均が高い', { timeout: 120000 }, () => {
    const play = (smart: boolean) => {
      let rng = createRng(mix32(11));
      let total = 0;
      for (let g = 0; g < 150; g++) {
        let raw: number;
        [rng, raw] = nextInt(rng, 0x7fffffff);
        let s = newKyoku(raw);
        while (!s.result) {
          const a = smart ? smartKyokuAction(s) : botAction(s, { target: '和了形', riichi: true });
          s = step(s, a as Parameters<typeof step>[1]);
        }
        if (s.result.type === 'win') total += s.result.score.points;
      }
      return total / 150;
    };
    expect(play(true)).toBeGreaterThan(play(false) * 1.3);
  });
});

describe('精算', () => {
  const lastKyoku = (score: number, target: number, honba = 0): RunState => {
    const run = createRun(1);
    return { ...run, round: { ...run.round, kyoku: 3, dealer: 3, score, target, honba } };
  };

  it('場の最後の局でなければ連荘する', () => {
    const run = createRun(1);
    expect(smartRenchan({ ...run, round: { ...run.round, kyoku: 0, dealer: 0 } }, 100)).toBe(true);
  });

  it('場の最後の局で、流局の罰符で目標を割る恐れがあれば和了やめにする', () => {
    // 1,000 点の目標に、和了で 1,100 点。罰符（1 本場で 600）とリーチ棒で割りうる
    expect(smartRenchan(lastKyoku(0, 1000), 1100)).toBe(false);
    // 罰符を引いても届くなら連荘する
    expect(smartRenchan(lastKyoku(0, 1000), 3000)).toBe(true);
    // まだ届いていなければ連荘する（和了やめると場で負ける）
    expect(smartRenchan(lastKyoku(0, 1000), 500)).toBe(true);
  });
});

describe('ショップ', () => {
  const inShop = (offers: Offer[], money: number, extra: Partial<RunState> = {}): RunState => ({
    ...createRun(1),
    phase: 'shop',
    afterShop: 'nextKyoku',
    shop: offers,
    money,
    ...extra,
  });

  it('価値の高い設備を買う', () => {
    const run = inShop(
      [
        { kind: 'consumable', id: 'hiroi', price: 3, sold: false },
        { kind: 'equip', id: 'turns', price: 8, sold: false },
      ],
      10,
    );
    expect(smartShopAction(run)).toEqual({ type: 'buy', index: 1 });
  });

  it('牌の改造には改造できる牌を選ぶ', () => {
    for (const id of ['shu', 'kin', 'nuki', 'utsushi'] as const) {
      const run = inShop([{ kind: 'mod', id, price: 3, sold: false }], 10);
      const a = smartShopAction(run);
      if (a.type === 'buy') expect(canModify(run.composition, id, a.target!)).toBe(true);
    }
  });

  it('お守りの枠がいっぱいなら、弱いお守りを売って強いお守りに買い替える', () => {
    const run = inShop([{ kind: 'charm', id: 'hakushi', price: 5, sold: false }], 6, {
      charms: ['chokin', 'hayazashi', 'tobiishi', 'iromegane', 'kazamidori'],
    });
    expect(smartShopAction(run)).toEqual({ type: 'sell', index: 0 });
  });

  it('買う品がなく祝儀もなければショップを出る', () => {
    expect(smartShopAction(inShop([{ kind: 'equip', id: 'turns', price: 8, sold: false }], 1))).toEqual({ type: 'leave' });
  });
});

describe('ラン', () => {
  it('ランを最後まで遊べ、同じシードなら同じ結果になる', { timeout: 120000 }, () => {
    let g = createGame(5);
    for (let n = 0; !isFinished(g); n++) {
      expect(n).toBeLessThan(5000);
      g = apply(g, smartAction(g));
    }
    const a = simulateRuns({ runs: 2, seed: 4, ai: 'smart', buy: true });
    expect(a.reached.reduce((x, y) => x + y, 0)).toBe(2);
    expect(simulateRuns({ runs: 2, seed: 4, ai: 'smart', buy: true })).toEqual(a);
  });
});
