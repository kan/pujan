/**
 * 遊んだ人の感想（docs/SPEC.md フェーズ 4.5）。読むのは backend/scripts/stats.mjs で行い、API では返さない。
 * 本文の上限と添えるランの様子の形は engine の feedback.ts（画面と同じもの）
 */
import type { FeedbackContext } from '@pujan/engine';

/** 1 つの ID が 1 時間に送れる件数 */
export const FEEDBACK_PER_HOUR = 5;

/**
 * 感想を残す。直近 1 時間に FEEDBACK_PER_HOUR 件送っていれば残さずに false。
 * 件数を数えるのと書くのを 1 つの文にして、同時に送られても上限を超えないようにする
 */
export async function saveFeedback(
  db: D1Database,
  accountId: string,
  body: string,
  // 画面が送らなかった項目は NULL で残す
  ctx: Partial<FeedbackContext>,
  now = Date.now(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO feedback (id, account_id, created_at, body, run_id, character, dan, wave, finished, score, engine_version, app_version)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM feedback WHERE account_id = ? AND created_at > ?) < ?`,
    )
    .bind(
      crypto.randomUUID(),
      accountId,
      now,
      body,
      ctx.runId ?? null,
      ctx.character ?? null,
      ctx.dan ?? null,
      ctx.wave ?? null,
      ctx.finished === undefined ? null : Number(ctx.finished),
      ctx.score ?? null,
      ctx.engineVersion ?? null,
      ctx.appVersion ?? null,
      accountId,
      now - 60 * 60 * 1000,
      FEEDBACK_PER_HOUR,
    )
    .run();
  return result.meta.changes > 0;
}
