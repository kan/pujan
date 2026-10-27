/**
 * 確率表の回帰テスト（docs/SPEC.md §3.3「難しさの目安」、§4.5「検証で分かった性質」）。
 *
 * 配牌 5 枚で形ができる確率は数え上げなので、仕様の値とぴったり一致させる。
 * 12 巡の和了率は AI の打ち方で変わるので、シード固定のうえで幅を持たせて確かめる。
 */
import { describe, expect, it } from 'vitest';
import { dealTable, simulateRuns, simulateTarget } from '../src/sim.js';

describe('配牌 5 枚で形ができる確率', () => {
  it('仕様の値（1/N）と一致する', () => {
    const oneIn = Object.fromEntries(dealTable().map((r) => [r.name, Math.round(1 / r.p)]));
    expect(oneIn).toEqual({
      基本和了: 1281,
      プチ国士: 2170,
      清一色: 6249,
      プチ小三元: 29756,
      プチ大三元: 1874652,
      和了形: 563,
    });
  });
});

describe('12 巡の和了率（保留なし・ネクストなし）', () => {
  const rate = (target: Parameters<typeof simulateTarget>[0]['target'], games = 600) =>
    simulateTarget({ target, games, seed: 1, rules: { holdSlots: 0, next: 0 } }).rate;

  it('基本和了・プチ国士・清一色が仕様の目安（21%・25%・12%）に近い', { timeout: 60000 }, () => {
    // 基本和了は AI の打ち方が仕様の測定より弱く、18% 前後になる
    const base = rate('基本和了');
    expect(base).toBeGreaterThan(0.15);
    expect(base).toBeLessThan(0.24);
    const kokushi = rate('プチ国士');
    expect(kokushi).toBeGreaterThan(0.21);
    expect(kokushi).toBeLessThan(0.3);
    const chinitsu = rate('清一色');
    expect(chinitsu).toBeGreaterThan(0.09);
    expect(chinitsu).toBeLessThan(0.16);
  });

  it('プチ小三元は数 %（仕様の目安 2.4%）', { timeout: 60000 }, () => {
    const r = rate('プチ小三元', 1000);
    expect(r).toBeGreaterThan(0.01);
    expect(r).toBeLessThan(0.05);
  });
});

describe('保留枠とネクスト', () => {
  it('保留枠が多いほど和了りやすい', { timeout: 60000 }, () => {
    const at = (holdSlots: number) => simulateTarget({ target: '基本和了', games: 300, seed: 2, rules: { holdSlots, next: 2 } }).rate;
    const r0 = at(0);
    const r3 = at(3);
    expect(r3 - r0).toBeGreaterThan(0.12);
  });

  it('ネクストが見えると和了りやすい', { timeout: 60000 }, () => {
    const at = (next: number) => simulateTarget({ target: '基本和了', games: 600, seed: 3, rules: { holdSlots: 0, next } }).rate;
    expect(at(2) - at(0)).toBeGreaterThan(0.08);
  });
});

describe('ランのシミュレーション', () => {
  it('同じシードなら同じ結果になる', { timeout: 60000 }, () => {
    const a = simulateRuns({ runs: 3, seed: 9 });
    expect(a.reached.reduce((x, y) => x + y, 0)).toBe(3);
    expect(simulateRuns({ runs: 3, seed: 9 })).toEqual(a);
  });
});
