/**
 * ID ごとの解禁の状態（docs/SPEC.md §4.6）。サーバーで確かめたランだけで更新する
 * （端末だけのランで解禁したものは、その端末の中だけ）。
 */
import { EMPTY_PROGRESS, type Progress } from '@pujan/engine';

/** progress の表の列（ほかの表と JOIN したときは、ない ID で NULL になる） */
export interface ProgressRow {
  yaku_won: string | null;
  best_waves: number | null;
  dan_cleared: number | null;
}

export const progressOfRow = (row: ProgressRow | null): Progress =>
  row?.yaku_won == null
    ? EMPTY_PROGRESS
    : { yakuWon: JSON.parse(row.yaku_won) as string[], bestWaves: row.best_waves!, danCleared: row.dan_cleared! };

export async function loadProgress(db: D1Database, accountId: string): Promise<Progress> {
  const row = await db
    .prepare('SELECT yaku_won, best_waves, dan_cleared FROM progress WHERE account_id = ?')
    .bind(accountId)
    .first<ProgressRow>();
  return progressOfRow(row);
}

/**
 * 解禁の状態を足し込む。解禁は減らないので、今の行と和を取る（同じランの再送や、読んでから書くまでに
 * 別の記録が入っても、解禁を失わない）。和の規則は engine の mergeProgress と同じ
 */
export const upsertProgress = (db: D1Database, accountId: string, p: Progress, now = Date.now()) =>
  db
    .prepare(
      `INSERT INTO progress (account_id, yaku_won, best_waves, dan_cleared, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET
         yaku_won = (SELECT json_group_array(value) FROM (
           SELECT value FROM json_each(progress.yaku_won) UNION SELECT value FROM json_each(excluded.yaku_won) ORDER BY value)),
         best_waves = MAX(progress.best_waves, excluded.best_waves),
         dan_cleared = MAX(progress.dan_cleared, excluded.dan_cleared),
         updated_at = excluded.updated_at`,
    )
    .bind(accountId, JSON.stringify(p.yakuWon), p.bestWaves, p.danCleared, now);
