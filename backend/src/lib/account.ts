/** 退会（kan/game docs/ID_DESIGN.md「退会」） */

/** ID の記録を持つ表と、ID を入れている列 */
export const ACCOUNT_TABLES = [
  ['runs', 'account_id'],
  ['weekly_best', 'account_id'],
  ['profiles', 'account_id'],
  ['progress', 'account_id'],
  ['feedback', 'account_id'],
] as const;

/**
 * 退会（GameService.deleteAccount）: ID を削除済みとして残し（以後その Cookie では書き込めない）、記録をすべて消す。
 * 何度呼んでも同じ結果になる。
 */
export async function deleteAccount(db: D1Database, accountId: string, now = Date.now()): Promise<void> {
  await db.batch([
    db
      .prepare('INSERT INTO deleted_accounts (account_id, deleted_at) VALUES (?, ?) ON CONFLICT (account_id) DO NOTHING')
      .bind(accountId, now),
    ...ACCOUNT_TABLES.map(([table, column]) => db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).bind(accountId)),
  ]);
}
