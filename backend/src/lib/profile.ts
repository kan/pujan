/** ランキングに出す名前と公開への同意（kan/game docs/ID_DESIGN.md「名前」。vegtab の lib/profile.ts と同じ形） */
import type { RegisterNameResult } from './id-rpc';

/** このゲームのランキングに出す名前。同意する前は null */
export async function getProfileName(db: D1Database, accountId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT display_name FROM profiles WHERE account_id = ?')
    .bind(accountId)
    .first<{ display_name: string }>();
  return row?.display_name ?? null;
}

/** registerName の答えを、このゲームでの扱いに直したもの */
export type NameOutcome = { status: 'registered' | 'kept'; name: string } | { status: 'name_taken' | 'invalid' | 'no_id' };

export function nameOutcome(registered: RegisterNameResult): NameOutcome {
  switch (registered.result) {
    case 'ok':
      return { status: 'registered', name: registered.name };
    case 'already_named':
      return { status: 'kept', name: registered.name };
    case 'name_taken':
    case 'invalid':
    case 'no_id':
      return { status: registered.result };
    default: {
      // kan/game の src/rpc.ts に結果が足されたら、ここがコンパイルで落ちる
      const unexpected: never = registered;
      throw new Error(`Unexpected registerName result: ${JSON.stringify(unexpected)}`);
    }
  }
}

/** ID 基盤が登録した名前と、ここでの公開への同意を書く。最初に同意した時刻は残す */
export async function registerProfile(db: D1Database, accountId: string, name: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profiles (account_id, display_name, consented_at) VALUES (?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(accountId, name, Date.now())
    .run();
}
