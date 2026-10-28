import { describe, expect, it } from 'vitest';
import { evaluateFive } from '../src/hand.js';
import { finalizeScore, limitName, pointsOfHan, type FinalizeContext } from '../src/score.js';
import { EAST, SOUTH, type Tile } from '../src/tiles.js';
import { bestWin, waits, type WinContext } from '../src/win.js';

const m = (n: number) => n - 1;
const p = (n: number) => 8 + n;

const ctx = (over: Partial<WinContext> = {}): WinContext => ({
  rules: { bakaze: EAST, seat: SOUTH },
  isJoker: () => false,
  copies: () => 4,
  doraKinds: [],
  doraMode: 'normal',
  menzenHan: 1,
  redHan: 1,
  noBonus: false,
  shibari: false,
  noLimit: false,
  ...over,
});
const tiles = (kinds: number[], extra: Partial<Tile>[] = []): Tile[] => kinds.map((kind, id) => ({ id, kind, ...extra[id] }));

describe('点数表', () => {
  it('4翻までは翻ごとに倍、5翻からは上限', () => {
    expect([0, 1, 2, 3, 4].map((h) => pointsOfHan(h))).toEqual([100, 200, 400, 800, 1600]);
    expect([5, 6, 7, 8, 10, 11, 12, 13, 20].map((h) => pointsOfHan(h))).toEqual([
      2000, 3000, 3000, 4000, 4000, 6000, 6000, 8000, 8000,
    ]);
    expect(limitName(9)).toBe('倍満');
  });

  it('青天井では上限がない', () => {
    expect(pointsOfHan(10, true)).toBe(102400);
    expect(limitName(10, true)).toBeNull();
  });

  it('親・リーチ後の巡・本場を重ねる', () => {
    const ev = evaluateFive([m(2), m(2), m(3), m(4), m(5)], { bakaze: EAST, seat: EAST })!; // 4翻
    const c: FinalizeContext = {
      noLimit: false,
      yakuLevels: {},
      cheapHandTimes4: false,
      dealer: true,
      dealerMultiplier: 1.5,
      riichiTurns: 2,
      riichiBonusPerTurn: 100,
      honba: 1,
      honbaBonus: 100,
    };
    expect(finalizeScore(ev, c).points).toBe(1600 * 1.5 + 200 + 100);
  });
});

describe('bestWin', () => {
  it('保留牌を使わなければ門前がつく', () => {
    const t = tiles([m(1), m(1), p(3), p(4), p(5)]);
    const w = bestWin(t, ctx({ holdIds: new Set() }))!;
    expect(w.evaluation.yaku.map((y) => y.name)).toEqual(['門前']);
    const w2 = bestWin(t, ctx({ holdIds: new Set([0]) }))!;
    expect(w2.evaluation.noYaku).toBe(true);
  });

  it('6枚あれば三対子も探す', () => {
    const t = tiles([m(2), m(2), m(6), m(6), m(8), m(8)]);
    const w = bestWin(t, ctx())!;
    expect(w.tileIds).toHaveLength(6);
    expect(w.evaluation.yaku[0].name).toBe('三対子');
  });

  it('万能牌は役が最も高くなる牌になる', () => {
    const t = tiles([m(4), m(4), p(4), p(5), 27]);
    const w = bestWin(t, ctx({ isJoker: (k) => k === p(4) || k === 27 }))!;
    expect(w.evaluation.yaku.map((y) => y.name)).toEqual(['プチ槓']);
  });

  it('万能牌の id と、当てはめた種類を返す', () => {
    // 一萬一萬・三筒四筒 に万能牌（中）。中は二筒か五筒になるしかない
    const t = tiles([m(1), m(1), p(3), p(4), 33]);
    const w = bestWin(t, ctx({ isJoker: (k) => k === 33 }))!;
    expect(w.jokers).toHaveLength(1);
    expect(w.jokers[0].id).toBe(4);
    expect([p(2), p(5)]).toContain(w.jokers[0].kind);
    expect(bestWin(t, ctx())).toBeNull();
    expect(bestWin(tiles([m(1), m(1), p(3), p(4), p(5)]), ctx())!.jokers).toEqual([]);
  });

  it('万能牌が 2 枚でも、牌ごとに当てはめた種類を返す', () => {
    const t = tiles([m(1), m(1), p(3), 33, 32]);
    const w = bestWin(t, ctx({ isJoker: (k) => k === 33 || k === 32 }))!;
    expect(w.jokers.map((j) => j.id)).toEqual([3, 4]);
    // 当てはめた種類と万能牌でない牌を合わせると、和了形の種類（kinds）になる
    const fixed = w.tileIds.filter((id) => id < 3).map((id) => t[id].kind);
    expect([...fixed, ...w.jokers.map((j) => j.kind)].sort()).toEqual(w.kinds.slice().sort());
  });

  it('ドラと赤はボーナスの翻、1翻縛りでは役に数えない', () => {
    const t = tiles([m(1), m(1), p(3), p(4), p(5)], [{}, {}, {}, {}, { red: true }]);
    const w = bestWin(t, ctx({ holdIds: new Set([0]), doraKinds: [m(1)] }))!;
    expect(w.evaluation.yaku.map((y) => [y.name, y.han])).toEqual([
      ['ドラ', 2],
      ['赤', 1],
    ]);
    expect(bestWin(t, ctx({ holdIds: new Set([0]), doraKinds: [m(1)], shibari: true }))).toBeNull();
  });
});

describe('waits', () => {
  it('両面待ち', () => {
    expect(waits(tiles([m(1), m(1), p(3), p(4)]), ctx())).toEqual(expect.arrayContaining([p(2), p(5)]));
  });
});
