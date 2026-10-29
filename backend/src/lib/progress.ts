/**
 * ID ごとの解禁の状態（docs/SPEC.md §4.6）。サーバーで確かめたランだけで更新する
 * （端末だけのランで解禁したものは、その端末の中だけ）。
 */
import { EMPTY_PROGRESS, withCharacters, type CharacterId, type Progress } from '@pujan/engine';

/** progress の表の列（ほかの表と JOIN したときは、ない ID で NULL になる） */
export interface ProgressRow {
  yaku_won: string | null;
  best_waves: number | null;
  dan_cleared: number | null;
  /** NULL は雀士の一覧を足す前の行（withCharacters で今の条件から求める） */
  characters: string | null;
}

export const progressOfRow = (row: ProgressRow | null): Progress =>
  row?.yaku_won == null
    ? EMPTY_PROGRESS
    : withCharacters({
        yakuWon: JSON.parse(row.yaku_won) as string[],
        bestWaves: row.best_waves!,
        danCleared: row.dan_cleared!,
        characters: row.characters == null ? undefined : (JSON.parse(row.characters) as CharacterId[]),
      });

export async function loadProgress(db: D1Database, accountId: string): Promise<Progress> {
  const row = await db
    .prepare('SELECT yaku_won, best_waves, dan_cleared, characters FROM progress WHERE account_id = ?')
    .bind(accountId)
    .first<ProgressRow>();
  const p = progressOfRow(row);
  // 雀士の一覧がない前の行は、求めた一覧を書き戻す（あとで雀士や条件が変わっても、読むたびに結果が変わらないように）
  if (row && row.yaku_won != null && row.characters == null) {
    await db
      .prepare('UPDATE progress SET characters = ? WHERE account_id = ? AND characters IS NULL')
      .bind(JSON.stringify(p.characters), accountId)
      .run();
  }
  return p;
}

/**
 * 解禁の状態を足し込む。解禁は減らないので、今の行と和を取る（同じランの再送や、読んでから書くまでに
 * 別の記録が入っても、解禁を失わない）。和の規則は engine の mergeProgress と同じ。
 * p は読んだ行から作ったものなので、雀士の一覧が NULL の前の行でも、求めた一覧が p に入っている
 */
export const upsertProgress = (db: D1Database, accountId: string, p: Progress, now = Date.now()) =>
  db
    .prepare(
      `INSERT INTO progress (account_id, yaku_won, best_waves, dan_cleared, characters, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET
         yaku_won = (SELECT json_group_array(value) FROM (
           SELECT value FROM json_each(progress.yaku_won) UNION SELECT value FROM json_each(excluded.yaku_won) ORDER BY value)),
         best_waves = MAX(progress.best_waves, excluded.best_waves),
         dan_cleared = MAX(progress.dan_cleared, excluded.dan_cleared),
         characters = (SELECT json_group_array(value) FROM (
           SELECT value FROM json_each(COALESCE(progress.characters, '[]'))
           UNION SELECT value FROM json_each(excluded.characters) ORDER BY value)),
         updated_at = excluded.updated_at`,
    )
    .bind(accountId, JSON.stringify(p.yakuWon), p.bestWaves, p.danCleared, JSON.stringify(p.characters), now);
