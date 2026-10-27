/**
 * 週ごとのランキング（docs/SPEC.md §5.4）。突破した場の数 → 合計点の順で、同じ成績は同じ順位。
 * 名前と公開への同意（profiles）がある ID だけを載せる。上位 RANKING_SIZE 人と、本人の記録を返す。
 */

export const RANKING_SIZE = 100;

/** 良い順の ORDER BY（同じ成績は同順位にするので、名前などで順を決めない）。t は weekly_best の別名 */
export const rankingOrder = (t: string) => `${t}.waves_cleared DESC, ${t}.total_score DESC`;

/** 成績 a が b より良いか（a・b は waves_cleared と total_score を持つ行の別名）。rankingOrder と同じ規則 */
export const betterThan = (a: string, b: string) =>
  `(${a}.waves_cleared > ${b}.waves_cleared OR (${a}.waves_cleared = ${b}.waves_cleared AND ${a}.total_score > ${b}.total_score))`;

export interface RankingEntry {
  rank: number;
  name: string;
  wavesCleared: number;
  totalScore: number;
  isMe: boolean;
}

export interface Ranking {
  week: string;
  entries: RankingEntry[];
  /** 本人のその週の最高記録。名前を公開していなければ rank は null（ランキングには載らない） */
  me: { rank: number | null; wavesCleared: number; totalScore: number } | null;
}

export async function weeklyRanking(db: D1Database, week: string, accountId: string): Promise<Ranking> {
  const [top, mine] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT RANK() OVER (ORDER BY ${rankingOrder('b')}) AS rank, p.display_name AS name,
           b.waves_cleared, b.total_score, b.account_id = ? AS is_me
         FROM weekly_best b JOIN profiles p ON p.account_id = b.account_id
         WHERE b.week = ?
         ORDER BY ${rankingOrder('b')}, b.finished_at ASC
         LIMIT ?`,
      )
      .bind(accountId, week, RANKING_SIZE),
    db
      .prepare(
        `SELECT b.waves_cleared, b.total_score,
           EXISTS (SELECT 1 FROM profiles WHERE account_id = b.account_id) AS named,
           (SELECT COUNT(*) FROM weekly_best o JOIN profiles op ON op.account_id = o.account_id
            WHERE o.week = b.week AND ${betterThan('o', 'b')}) + 1 AS rank
         FROM weekly_best b WHERE b.week = ? AND b.account_id = ?`,
      )
      .bind(week, accountId),
  ]);
  const entries = top.results.map((r) => ({
    rank: Number(r.rank),
    name: String(r.name),
    wavesCleared: Number(r.waves_cleared),
    totalScore: Number(r.total_score),
    isMe: !!r.is_me,
  }));
  const m = mine.results[0];
  return {
    week,
    entries,
    me: m
      ? { rank: m.named ? Number(m.rank) : null, wavesCleared: Number(m.waves_cleared), totalScore: Number(m.total_score) }
      : null,
  };
}
