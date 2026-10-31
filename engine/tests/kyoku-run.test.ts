import { describe, expect, it } from 'vitest';
import {
  DEALER_EXTRA_TURNS,
  DEFAULT_BASE_RULES,
  EXTEND_TURNS,
  GOLD_PER_MOD,
  HONBA_TURN_CUT,
  MIN_TURNS,
  modifiersFor,
  type EquipId,
  type ModId,
} from '../src/items.js';
import {
  allTiles,
  canRiichi,
  canUseConsumable,
  defaultComposition,
  isActing,
  judge,
  remainingOf,
  startKyoku,
  step,
  turnLimit,
  type KyokuSetup,
  type KyokuState,
} from '../src/kyoku.js';
import { createRng, nextInt } from '../src/rng.js';
import { apply, type GameState } from '../src/game.js';
import { beginKyoku, buy, canModify, createRun, leaveShop, settleKyoku, type RunState } from '../src/run.js';
import { EAST, SOUTH, suit, type Tile } from '../src/tiles.js';

function newKyoku(seed: number): KyokuState {
  return startKyoku({
    rng: createRng(seed),
    composition: defaultComposition(true),
    mods: modifiersFor(DEFAULT_BASE_RULES, { charms: [], equipment: [] }, null),
    bakaze: EAST,
    seat: SOUTH,
    dealer: false,
    honba: 0,
    yakuLevels: {},
  });
}

/** 和了れれば和了り、そうでなければ乱数で捨てるか保留する */
function playOut(s: KyokuState, seed: number): KyokuState {
  let rng = createRng(seed);
  let k = s;
  for (let guard = 0; guard < 200 && !k.result; guard++) {
    if (k.win) {
      k = step(k, { type: 'tsumo' });
      break;
    }
    let r: number;
    [rng, r] = nextInt(rng, 100);
    const empty = k.hold.indexOf(null);
    if (k.riichi) k = step(k, { type: 'discard', zone: 'drawn', index: 0 });
    else if (r < 30 && empty >= 0) k = step(k, { type: 'hold', zone: 'drawn', index: 0, slot: empty });
    else if (r < 40 && canRiichi(k, 'drawn', 0)) k = step(k, { type: 'riichi', zone: 'drawn', index: 0 });
    else {
      [rng, r] = nextInt(rng, k.hand.length);
      k = step(k, { type: 'discard', zone: 'hand', index: r });
    }
  }
  return k;
}

describe('局の進行', () => {
  it('配牌は4枚、1巡目のツモが1枚', () => {
    const k = newKyoku(42);
    expect(k.hand).toHaveLength(4);
    expect(k.drawn).toHaveLength(1);
    expect(k.turn).toBe(1);
    expect(isActing(k)).toBe(true);
  });

  it('牌の枚数は局の間ずっと保たれる', () => {
    let k = newKyoku(7);
    const total = () => k.wall.length + allTiles(k).length + k.river.length + k.indicators.length;
    expect(total()).toBe(136);
    for (let i = 0; i < 5 && isActing(k); i++) {
      k = step(k, { type: 'discard', zone: 'drawn', index: 0 });
      expect(total()).toBe(136);
    }
  });

  it('同じシードと操作なら同じ結果になる', () => {
    const a = playOut(newKyoku(123), 9);
    const b = playOut(newKyoku(123), 9);
    expect(a.result).toEqual(b.result);
  });

  it('手牌を捨ててリーチを宣言できる（宣言の打牌はツモ切りでなくてよい）', () => {
    let found = 0;
    for (let seed = 1; seed <= 300 && found < 3; seed++) {
      let k = newKyoku(seed);
      for (let guard = 0; guard < 12 && isActing(k) && !k.riichi; guard++) {
        const i = k.hand.findIndex((_, j) => canRiichi(k, 'hand', j));
        if (i >= 0) {
          const tile = k.hand[i];
          k = step(k, { type: 'riichi', zone: 'hand', index: i });
          expect(k.riichi).not.toBeNull();
          expect(k.river.at(-1)).toEqual(tile);
          found++;
          break;
        }
        k = step(k, { type: 'discard', zone: 'drawn', index: 0 });
      }
    }
    expect(found).toBe(3);
  });

  it('山の並びを指定して始められる（チュートリアル用）', () => {
    const order = { indicators: [EAST], hand: [2, 3, 27, 26], draws: [28, 33, 27, 4] };
    let k = startKyoku(
      {
        rng: createRng(1),
        composition: defaultComposition(true),
        mods: modifiersFor(DEFAULT_BASE_RULES, { charms: [], equipment: [] }, null),
        bakaze: EAST,
        seat: SOUTH,
        dealer: false,
        honba: 0,
        yakuLevels: {},
      },
      order,
    );
    expect(k.indicators.map((t) => t.kind)).toEqual([EAST]);
    expect(k.hand.map((t) => t.kind).sort((a, b) => a - b)).toEqual([2, 3, 26, 27]);
    const drawn: number[] = [];
    for (let i = 0; i < 4 && isActing(k); i++) {
      drawn.push(k.drawn[0].kind);
      k = step(k, { type: 'discard', zone: 'drawn', index: 0 });
    }
    expect(drawn).toEqual(order.draws);
    // 指定した牌の赤牌は使わない（5萬は赤でない牌）
    expect(k.river.at(-1)?.red).toBeFalsy();
  });

  it('12巡で必ず終わる', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const k = playOut(newKyoku(seed), seed);
      expect(k.result).not.toBeNull();
      expect(k.turn).toBeLessThanOrEqual(12);
    }
  });
});

/** 和了らずにツモ切りを続け、最終巡（打牌の前）まで進める */
function toLastTurn(s: KyokuState): KyokuState {
  let k = s;
  while (!k.result && k.turn < turnLimit(k)) k = step(k, { type: 'discard', zone: 'drawn', index: 0 });
  return k;
}

function kyokuSetup(seed: number, equipment: EquipId[] = [], dealer = false): KyokuSetup {
  return {
    rng: createRng(seed),
    composition: defaultComposition(true),
    mods: modifiersFor(DEFAULT_BASE_RULES, { charms: [], equipment }, null, dealer),
    bakaze: EAST,
    seat: SOUTH,
    dealer,
    honba: 0,
    yakuLevels: {},
  };
}

function kyokuWith(seed: number, equipment: EquipId[], dealer = false): KyokuState {
  return startKyoku(kyokuSetup(seed, equipment, dealer));
}

describe('消耗品と設備', () => {
  it('染め粉: 選んだ色以外の数牌を山から全部抜き、選んだ色と字牌は残す', () => {
    const k = newKyoku(11);
    const count = (tiles: readonly Tile[], color: number) => tiles.filter((t) => suit(t.kind) === color).length;
    const used = step(k, { type: 'consumable', id: 'some', color: 1 });
    expect(count(used.wall, 1)).toBe(count(k.wall, 1));
    expect(count(used.wall, 3)).toBe(count(k.wall, 3));
    expect(count(used.wall, 0) + count(used.wall, 2)).toBe(0);
    expect(used.removed).toHaveLength(count(k.wall, 0) + count(k.wall, 2));
    expect(used.wall.length + used.removed.length).toBe(k.wall.length);
    // 抜いた牌は待ちの残り枚数から引く
    const kind = used.removed[0].kind;
    const removedOfKind = used.removed.filter((t) => t.kind === kind).length;
    expect(remainingOf(used, kind)).toBe(remainingOf(k, kind) - removedOfKind);
  });

  it('染め粉: 色の指定がないか範囲外なら使えない。リーチ中も使えない', () => {
    const k = newKyoku(11);
    expect(() => step(k, { type: 'consumable', id: 'some' })).toThrow();
    // 字牌（3）は選べない
    expect(() => step(k, { type: 'consumable', id: 'some', color: 3 })).toThrow();
    expect(() => step(k, { type: 'consumable', id: 'some', color: 1.5 })).toThrow();
    expect(canUseConsumable({ ...k, riichi: { turn: 1, stick: 100 } }, 'some')).toBe(false);
    // 色を取らない消耗品に色を付けた操作も拒む
    expect(() => step(k, { type: 'consumable', id: 'nozoki', color: 0 })).toThrow();
  });

  it('延長札: 最終巡のツモのあとだけ使え、巡数が延びる（1 局に 1 回。リーチ中も使える）', () => {
    const k = newKyoku(3);
    expect(canUseConsumable(k, 'encho')).toBe(false);
    const last = toLastTurn(k);
    expect(last.result).toBeNull();
    expect(last.turn).toBe(12);
    expect(canUseConsumable({ ...last, riichi: { turn: 5, stick: 100 } }, 'encho')).toBe(true);
    // 山が尽きていれば延ばしても引けないので使えない
    expect(canUseConsumable({ ...last, wall: [] }, 'encho')).toBe(false);
    const extended = step(last, { type: 'consumable', id: 'encho' });
    expect(turnLimit(extended)).toBe(12 + EXTEND_TURNS);
    expect(canUseConsumable(extended, 'encho')).toBe(false);
    const next = step(extended, { type: 'discard', zone: 'drawn', index: 0 });
    expect(next.result).toBeNull();
    expect(next.turn).toBe(13);
    const end = toLastTurn(next);
    expect(end.turn).toBe(12 + EXTEND_TURNS);
    expect(canUseConsumable(end, 'encho')).toBe(false);
  });

  it('平常心: リーチが 2 翻になり、流局してもリーチ棒が戻る', () => {
    for (const [equipment, han, lost] of [[[], 1, 100], [['heijoshin'], 2, 0]] as const) {
      const mods = modifiersFor(DEFAULT_BASE_RULES, { charms: [], equipment: [...equipment] }, null);
      // 1萬1萬2萬3萬＋ツモ4萬で和了れる局
      const order = { indicators: [30], hand: [0, 0, 1, 2], draws: [3] };
      const setup = { ...kyokuSetup(1), mods };
      const k = startKyoku(setup, order);
      // 1 巡目の和了は天和（役満）になるので、巡を進めた形にする
      const riichi = { ...k, turn: 3, discards: 2, riichi: { turn: 2, stick: 100 } };
      expect(judge(riichi)!.evaluation.yaku.find((y) => y.name === 'リーチ')!.han).toBe(han);
      const drawn = toLastTurn({ ...startKyoku(setup), riichi: { turn: 1, stick: 100 } });
      const end = step(drawn, { type: 'discard', zone: 'drawn', index: 0 });
      expect(end.result).toMatchObject({ type: 'draw', stickLost: lost });
    }
  });

  it('上座: 親番の局だけ巡数が増える', () => {
    expect(kyokuWith(1, ['kamiza'], true).setup.mods.turns).toBe(12 + DEALER_EXTRA_TURNS);
    expect(kyokuWith(1, ['kamiza'], false).setup.mods.turns).toBe(12);
    expect(kyokuWith(1, [], true).setup.mods.turns).toBe(12);
  });

  it('本場が積まれるほど巡数が減る（下限あり）', () => {
    const turns = (honba: number, equipment: EquipId[] = []) =>
      modifiersFor(DEFAULT_BASE_RULES, { charms: [], equipment }, null, true, honba).turns;
    expect(turns(0)).toBe(12);
    expect(turns(1)).toBe(12 - HONBA_TURN_CUT);
    expect(turns(3)).toBe(12 - 3 * HONBA_TURN_CUT);
    expect(turns(3, ['kamiza'])).toBe(12 + DEALER_EXTRA_TURNS - 3 * HONBA_TURN_CUT);
    expect(turns(99)).toBe(MIN_TURNS);
  });
});

describe('牌の改造', () => {
  const comp = (mods: { id: ModId; kind: number }[]) => createRun(1, { mods }).composition;

  it('朱塗りは選んだ牌を全部赤牌にする（写しのあとなら 5 枚）', () => {
    expect(comp([{ id: 'shu', kind: 13 }]).red[13]).toBe(4);
    expect(comp([{ id: 'utsushi', kind: 13 }, { id: 'shu', kind: 13 }]).red[13]).toBe(5);
    // 赤牌でない牌がもうなければ選べない
    expect(canModify(comp([{ id: 'shu', kind: 13 }]), 'shu', 13)).toBe(false);
  });

  it('金箔は選んだ牌の 2 枚を金牌にし、赤牌は金牌にしない', () => {
    expect(comp([{ id: 'kin', kind: 0 }]).gold[0]).toBe(GOLD_PER_MOD);
    const c = comp([{ id: 'kin', kind: 4 }, { id: 'kin', kind: 4 }]);
    // 5萬は赤牌が 1 枚あるので、金牌は 3 枚まで
    expect(c.gold[4]).toBe(3);
    expect(canModify(c, 'kin', 4)).toBe(false);
    expect(canModify(c, 'shu', 4)).toBe(false);
  });
});

describe('ラン', () => {
  function playRun(seed: number): RunState {
    let run = createRun(seed);
    for (let guard = 0; guard < 400; guard++) {
      if (run.phase === 'over' || run.phase === 'cleared') return run;
      if (run.phase === 'shop') {
        const i = run.shop!.findIndex((o) => !o.sold && o.price <= run.money && o.kind !== 'mod');
        if (i >= 0) {
          try {
            run = buy(run, i);
          } catch {
            // 枠がいっぱいなら買わない
          }
        }
        run = leaveShop(run);
        continue;
      }
      const started = beginKyoku(run);
      run = started.run;
      const k = playOut(started.kyoku, seed + guard);
      run = settleKyoku(run, k.result!, true);
    }
    throw new Error('run did not finish');
  }

  it('ランは終わりまで進む', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const run = playRun(seed);
      expect(['over', 'cleared']).toContain(run.phase);
    }
  });

  it('同じシードなら同じ展開になる', () => {
    expect(playRun(5)).toEqual(playRun(5));
  });

  it('連荘のあいだはショップを開かず、連荘が途切れたところで開く', () => {
    const run = createRun(3);
    const dealer = { ...run, round: { ...run.round, kyoku: run.round.dealer } };
    let g: GameState = { ...beginKyoku(dealer), previous: null };
    let renchans = 0;
    // 親の局を和了るまで打ち、和了れば連荘する。流局で親が流れたら終わり
    for (let seed = 1; g.run.round.kyoku === dealer.round.kyoku && g.kyoku; seed++) {
      g = { ...g, kyoku: playOut(g.kyoku, seed) };
      const won = g.kyoku!.result!.type === 'win';
      g = apply(g, { type: 'settle', renchan: won });
      if (!won) break;
      renchans++;
      // 連荘: ショップを開かずに次の本場が始まる
      expect(g.run.phase).toBe('kyoku');
      expect(g.run.shop).toBeNull();
      expect(g.run.round.honba).toBe(renchans);
      expect(g.kyoku?.result).toBeNull();
    }
    // 流局で親が流れると、ショップが開く
    expect(g.run.phase).toBe('shop');
    expect(g.run.round.honba).toBe(0);
  });
});
