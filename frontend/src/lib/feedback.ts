/** 感想（docs/SPEC.md フェーズ 4.5）を送る前に見せる文 */
import type { FeedbackContext } from '@pujan/engine';
import { WIND_NAMES, startLabel, summaryText } from './labels';

/** 添えるものの説明（「くま・初段、南場 1,200点、版 0.0.1+abc」） */
export function contextText(ctx: FeedbackContext): string {
  const where = ctx.finished
    ? summaryText({ wavesCleared: ctx.wave, totalScore: ctx.score })
    : `${WIND_NAMES[ctx.wave]}場 ${ctx.score.toLocaleString()}点`;
  return `${startLabel(ctx)}、${where}、版 ${ctx.appVersion}`;
}
