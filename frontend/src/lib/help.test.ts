import { describe, expect, it } from 'vitest';
import { EAST, SOUTH, evaluateFive, evaluateSix, step, type KyokuMove } from '@pujan/engine';
import { SCORE_TABLE, YAKU_TABS } from './help';
import { PLAY_STEPS, isExpectedMove, nextTarget, tutorialKyoku } from './tutorial';

describe('役表の例', () => {
  const rows = YAKU_TABS.flatMap((t) => t.rows).filter((r) => r.example);

  it.each(rows.map((r) => [r.name, r.example!] as const))('%s の例は、その役になる', (name, example) => {
    const rules = { bakaze: EAST, seat: SOUTH };
    const ev = example.length === 6 ? evaluateSix(example, rules) : evaluateFive(example, rules);
    expect(ev?.yaku.map((y) => y.name)).toContain(name);
  });
});

it('点数表は仕様（docs/SPEC.md §3.4）の表と同じになる', () => {
  expect(SCORE_TABLE).toEqual([
    ['役なし', '100点'],
    ['1翻', '200点'],
    ['2翻', '400点'],
    ['3翻', '800点'],
    ['4翻', '1,600点'],
    ['5翻（満貫）', '2,000点'],
    ['6〜7翻（跳満）', '3,000点'],
    ['8〜10翻（倍満）', '4,000点'],
    ['11〜12翻（三倍満）', '6,000点'],
    ['13翻〜（数え役満）', '8,000点'],
    ['役満', '8,000点'],
  ]);
});

describe('チュートリアルの筋書き', () => {
  it('言われた操作だけで、和了まで進む', () => {
    let k = tutorialKyoku();
    // 各段階で言われた操作（筋書きの答え）。9索の位置はその時点の手牌で探す
    const moves: (() => KyokuMove)[] = [
      () => ({ type: 'discard', zone: 'drawn', index: 0 }),
      () => ({ type: 'hold', zone: 'drawn', index: 0, slot: 0 }),
      () => ({ type: 'discard', zone: 'hand', index: k.hand.findIndex((t) => t.kind === 26) }),
      () => ({ type: 'tsumo' }),
    ];
    PLAY_STEPS.forEach((st, i) => {
      // 和了の段階の前は和了れない（筋書きの途中で偶然和了れない）
      if (i < PLAY_STEPS.length - 1) expect(k.win).toBeNull();
      const move = moves[i]();
      expect(isExpectedMove(st, move, k), st.title).toBe(true);
      k = step(k, move);
    });
    expect(k.result?.type).toBe('win');
    if (k.result?.type !== 'win') return;
    // 説明（GUIDE_PAGES の「和了の点数」）と同じ役と点数
    expect(k.result.win.evaluation.yaku.map((y) => y.name)).toEqual(['混一色', '役牌', '門前']);
    expect(k.result.score.points).toBe(1600);
  });

  it('言われていない操作は進めない', () => {
    const k = tutorialKyoku();
    expect(isExpectedMove(PLAY_STEPS[0], { type: 'discard', zone: 'hand', index: 0 }, k)).toBe(false);
    expect(isExpectedMove(PLAY_STEPS[0], { type: 'hold', zone: 'drawn', index: 0 }, k)).toBe(false);
  });

  it('次に押すところ: 牌 → （保留なら）空き枠 → 和了ボタン', () => {
    const [discard, hold, , tsumo] = PLAY_STEPS;
    expect(nextTarget(discard, null)).toEqual({ tile: discard.tile });
    // 捨てる段階では、選んだあとも同じ牌（もう一度タップ）
    expect(nextTarget(discard, discard.tile!)).toEqual({ tile: discard.tile });
    expect(nextTarget(hold, null)).toEqual({ tile: hold.tile });
    expect(nextTarget(hold, hold.tile!)).toEqual({ slot: true });
    expect(nextTarget(tsumo, null)).toEqual({ button: 'tsumo' });
  });
});
