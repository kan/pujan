import { describe, expect, it } from 'vitest';
import { createGame } from '@pujan/engine';
import { modifiedKinds } from './labels';

describe('modifiedKinds', () => {
  const run = createGame(1).run;

  it('改造していなければ空（はじめからある赤の 5 は数えない）', () => {
    expect(modifiedKinds(run).size).toBe(0);
  });

  it('枚数・赤・金のどれかが変わった牌を返す', () => {
    const c = run.composition;
    const count = [...c.count];
    const red = [...c.red];
    const gold = [...c.gold];
    count[0] = 5; // 写し
    red[10] = 2; // 朱塗り
    gold[30] = 1; // 金箔
    count[33] = 0; // 抜き取り
    const modded = { ...run, composition: { ...c, count, red, gold } };
    expect([...modifiedKinds(modded)].sort((a, b) => a - b)).toEqual([0, 10, 30, 33]);
  });
});
