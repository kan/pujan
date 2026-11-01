/**
 * 賢く打つ AI（src/ai.ts。GitHub issue #13）のテスト。
 *
 * 強さそのものは sim で測る（npm run sim -w engine -- starts --ai smart）。ここでは、山の並びを読まないこと、
 * 同じ状態から同じ手を選ぶこと、ランを最後まで遊べること、局とショップの判断の要所を確かめる。
 */
import { describe, expect, it } from 'vitest';
import { situationOf, smartAction, smartKyokuAction, smartRenchan, smartShopAction } from '../src/ai.js';
import { apply, createGame, isFinished } from '../src/game.js';
import { DEFAULT_BASE_RULES, modifiersFor, type CharmId, type EquipId } from '../src/items.js';
import { defaultComposition, startKyoku, step, type KyokuState, type WallOrder } from '../src/kyoku.js';
import { YAKUMAN_MARK, makeMission, type Mission } from '../src/mission.js';
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
  /** オーラス（親番）で、お題を決めたラン */
  const lastKyoku = (missions: Mission | Mission[], score: number, dan = 0, wins = 0): RunState => {
    const run = createRun(1, { start: { character: 'standard', dan, unlockedYaku: [] } });
    // ボスは巡数を変えないもの（早仕舞いだと連荘の巡数の見積もりが変わる）
    const round = { ...run.round, kyoku: 3, dealer: 3, score, wins, boss: 'seal' as const };
    return { ...run, phase: 'kyoku', shop: null, afterShop: null, missions: [missions].flat(), round };
  };

  it('オーラスでなければ連荘する', () => {
    const run = createRun(1);
    expect(smartRenchan({ ...run, round: { ...run.round, kyoku: 0, dealer: 0 } }, 100)).toBe(true);
  });

  it('オーラスで点数のお題を果たしたあと、流局の罰符で割る恐れがあれば和了やめにする', () => {
    const points = makeMission('points', 1, 1);
    // 3,000 点のお題に、和了で 3,100 点。罰符（1 本場で 600）とリーチ棒で割りうる
    expect(smartRenchan(lastKyoku(points, 2000), 1100)).toBe(false);
    // 罰符を引いても届くなら連荘する
    expect(smartRenchan(lastKyoku(points, 2000), 3000)).toBe(true);
    // まだ届いていなければ連荘する（和了やめるとクリアにならない）
    expect(smartRenchan(lastKyoku(points, 0), 500)).toBe(true);
  });

  it('オーラスで回数・役のお題をまだ果たしていなければ連荘する', () => {
    expect(smartRenchan(lastKyoku(makeMission('wins', 2, 1), 0, 0, 1), 400)).toBe(true);
    const yaku = makeMission('yaku', 2, 1, '役牌');
    expect(smartRenchan(lastKyoku(yaku, 0), 400, ['断么九'])).toBe(true);
  });

  it('回数か役のお題を果たしていれば、点数のお題を割る恐れがあっても連荘する（果たしたお題は減らない）', () => {
    const both = [makeMission('points', 1, 1), makeMission('wins', 1, 1.5)];
    expect(smartRenchan(lastKyoku(both, 2000, 0, 1), 1100)).toBe(true);
  });

  it('雀聖でオーラスの和了の条件（2,000 点以上）をまだ満たしていなければ連荘する', () => {
    const run = lastKyoku(makeMission('points', 1, 1), 99999, 5);
    expect(smartRenchan(run, 1900)).toBe(true);
    // 条件もお題も満たしていれば、連荘で巡が減っても続ける理由はない（巡は本場ごとに 2 減る。12 巡の 1 本場は 10 巡）
    expect(smartRenchan(run, 2000)).toBe(true);
    expect(smartRenchan({ ...run, round: { ...run.round, honba: 3 } }, 2000)).toBe(false);
  });
});

describe('お題の見方', () => {
  it('3 つのお題の進み具合を種類ごとに持ち、果たした回数・役のお題は倍率に数える', () => {
    const run = createRun(1);
    const missions = [makeMission('wins', 2, 1), makeMission('points', 2, 1.5), makeMission('yaku', 5, 2, YAKUMAN_MARK)];
    const sit = situationOf({ ...run, missions, round: { ...run.round, wins: 1, score: 1000 } });
    expect(sit).toMatchObject({ need: 4000, pointsTimes: 1.5, winsNeed: 2, winsTimes: 1, yaku: [YAKUMAN_MARK], yakuTimes: 2, metTimes: 0 });
    // 役のお題は、上の段の役でも果たせる
    const lower = situationOf({ ...run, missions: [makeMission('yaku', 3, 1, 'プチ一通')] });
    expect(lower.yaku).toEqual(['プチ一通', 'プチ小三元', YAKUMAN_MARK]);
    const done = situationOf({ ...run, missions, round: { ...run.round, wins: 3, score: 1000 } });
    expect(done).toMatchObject({ winsNeed: 0, metTimes: 1 });
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
    expect(a.runs).toBe(2);
    // お題は 1 ランに 3 つ
    expect(Object.values(a.byMission).reduce((x, t) => x + t.runs, 0)).toBe(6);
    expect(simulateRuns({ runs: 2, seed: 4, ai: 'smart', buy: true })).toEqual(a);
  });
});
