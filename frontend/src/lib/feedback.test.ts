import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, apply, createGame, feedbackContext, isFinished, type GameState } from '@pujan/engine';
import { contextText } from './feedback';

/** ラン終了までツモ切りを続ける（和了らないので東場で終わる） */
function playToEnd(g: GameState): GameState {
  while (!isFinished(g)) {
    if (!g.kyoku) g = apply(g, { type: 'leave' });
    else if (!g.kyoku.result) g = apply(g, { type: 'discard', zone: 'drawn', index: 0 });
    else g = apply(g, { type: 'settle' });
  }
  return g;
}

describe('感想に添えるランの様子', () => {
  it('進めているランは、場と場の点数', () => {
    const g = createGame(1, { start: { character: 'speed', dan: 1, unlockedYaku: [] } });
    const ctx = feedbackContext(g, 'run-1', '0.0.1+abc');
    expect(ctx).toEqual({
      runId: 'run-1',
      character: 'speed',
      dan: 1,
      wave: 0,
      finished: false,
      score: 0,
      engineVersion: ENGINE_VERSION,
      appVersion: '0.0.1+abc',
    });
    expect(contextText(ctx)).toBe('うさぎ・二段、東場 0点、版 0.0.1+abc');
  });

  it('場を突破した直後のショップでは、次の場の 0 点', () => {
    // 東場で突破したことにした状態（ショップに入った直後。run.wave はまだ東場）
    const g = createGame(3);
    const shop: GameState = {
      ...g,
      kyoku: null,
      run: { ...g.run, phase: 'shop', afterShop: 'nextWave', waveScores: [1500], round: { ...g.run.round, score: 1500 } },
    };
    const ctx = feedbackContext(shop, null, 'v');
    expect(ctx).toMatchObject({ wave: 1, finished: false, score: 0 });
    expect(contextText(ctx)).toBe('くま・初段、南場 0点、版 v');
  });

  it('終わったランは、突破した場の数と合計点', () => {
    const g = playToEnd(createGame(2));
    const ctx = feedbackContext(g, null, 'v');
    expect(ctx.finished).toBe(true);
    expect(ctx.wave).toBe(0);
    expect(ctx.score).toBe(g.run.waveScores.reduce((a, s) => a + s, 0));
    expect(contextText(ctx)).toBe(`くま・初段、0場突破・合計${ctx.score.toLocaleString()}点、版 v`);
  });
});
