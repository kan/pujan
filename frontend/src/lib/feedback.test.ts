import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, apply, createGame, feedbackContext, isFinished, missionText, type GameState } from '@pujan/engine';
import { contextText, sentAtText } from './feedback';

/** ラン終了までツモ切りを続ける */
function playToEnd(g: GameState): GameState {
  while (!isFinished(g)) {
    if (!g.kyoku) g = apply(g, { type: 'leave' });
    else if (!g.kyoku.result) g = apply(g, { type: 'discard', zone: 'drawn', index: 0 });
    else g = apply(g, { type: 'settle' });
  }
  return g;
}

describe('感想に添えるランの様子', () => {
  it('ランの始めは、お題と東 1 局の前', () => {
    const g = createGame(1, { start: { character: 'speed', dan: 1, unlockedYaku: [] } });
    const ctx = feedbackContext(g, 'run-1', '0.0.1+abc');
    const missions = g.run.missions.map(missionText).join('・');
    expect(ctx).toEqual({
      runId: 'run-1',
      character: 'speed',
      dan: 1,
      kyoku: 0,
      missions,
      finished: false,
      cleared: null,
      score: 0,
      engineVersion: ENGINE_VERSION,
      appVersion: '0.0.1+abc',
    });
    expect(contextText(ctx)).toBe(`うさぎ・二段、${missions}・東1局の前 0点、版 0.0.1+abc`);
  });

  it('局のあとのショップでは、その局まで終えている', () => {
    let g = apply(createGame(3), { type: 'leave' });
    while (!g.kyoku!.result) g = apply(g, { type: 'discard', zone: 'drawn', index: 0 });
    g = apply(g, { type: 'settle' });
    if (g.run.phase !== 'shop') return; // 親の連荘が続くときは試さない
    const ctx = feedbackContext(g, null, 'v');
    expect(ctx).toMatchObject({ kyoku: 1, finished: false, cleared: null });
    expect(contextText(ctx)).toBe(`くま・初段、${ctx.missions}・東1局まで ${ctx.score.toLocaleString()}点、版 v`);
  });

  it('終わったランは、クリアしたかと合計点。果たしたお題には（済）が付く', () => {
    const g = playToEnd(createGame(2));
    const ctx = feedbackContext(g, null, 'v');
    expect(ctx).toMatchObject({ finished: true, kyoku: 4, cleared: g.run.phase === 'cleared', score: g.run.round.score });
    expect(ctx.missions.includes('（済）')).toBe(ctx.cleared);
    expect(contextText(ctx)).toBe(
      `くま・初段、${ctx.missions}・${ctx.cleared ? 'クリア' : '未達'}・合計${ctx.score.toLocaleString()}点、版 v`,
    );
  });
});

describe('送った感想の日時', () => {
  it('端末の時刻で出す', () => {
    expect(sentAtText(new Date(2026, 9, 28, 9, 5).getTime())).toBe('2026/10/28 9:05');
  });
});
