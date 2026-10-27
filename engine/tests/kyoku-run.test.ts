import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_RULES, modifiersFor } from '../src/items.js';
import { allTiles, canRiichi, defaultComposition, isActing, startKyoku, step, type KyokuState } from '../src/kyoku.js';
import { createRng, nextInt } from '../src/rng.js';
import { beginKyoku, buy, createRun, leaveShop, settleKyoku, type RunState } from '../src/run.js';
import { EAST, SOUTH } from '../src/tiles.js';

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
});
