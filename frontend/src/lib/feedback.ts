/** 感想（docs/SPEC.md フェーズ 4.5）を送る前に見せる文 */
import type { FeedbackContext } from '@pujan/engine';
import { startLabel } from './labels';

/** 添えるものの説明（「くま・初段、×1 和了 2 回（済）・×1.5 …・東2局まで 1,200点、版 0.0.1+abc」） */
export function contextText(ctx: FeedbackContext): string {
  const where = ctx.finished
    ? `${ctx.cleared ? 'クリア' : '未達'}・合計${ctx.score.toLocaleString()}点`
    : `${ctx.kyoku ? `東${ctx.kyoku}局まで` : '東1局の前'} ${ctx.score.toLocaleString()}点`;
  return `${startLabel(ctx)}、${ctx.missions}・${where}、版 ${ctx.appVersion}`;
}

/** 送った日時（端末の時刻で「2026/10/28 9:05」） */
export function sentAtText(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${mm}`;
}
