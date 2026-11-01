/**
 * 週ごとのランキング（docs/SPEC.md §5.4）。段位 → クリアしたか → 記録点の順で、同じ成績は同じ順位。
 * 雀士とお題は区別しない（表示だけする）。
 * 名前と公開への同意（profiles）がある ID だけを載せる。上位 RANKING_SIZE 人と、本人の記録を返す。
 */
import { summaryOf, type MissionResult, type RecordedSummary } from '@pujan/engine';

export const RANKING_SIZE = 100;

/**
 * 良い順の ORDER BY（同じ成績は同順位にするので、名前などで順を決めない）。t は weekly_best の別名。
 * 4 場の形で記録した行（missions が NULL）は、段位によらず東風戦の記録の下に並べる（docs/SPEC.md §4.6）
 */
export const rankingOrder = (t: string) =>
  `(${t}.missions IS NULL) ASC, ${t}.dan DESC, ${t}.cleared DESC, ${t}.record_score DESC`;

/**
 * 成績 a が b より良いか（a・b は missions・dan・cleared・record_score を持つ行の別名）。rankingOrder と同じ規則。
 * 東風戦の記録は、4 場の形の記録よりいつも良い
 */
export const betterThan = (a: string, b: string) =>
  `((${a}.missions IS NOT NULL AND ${b}.missions IS NULL) OR ((${a}.missions IS NULL) = (${b}.missions IS NULL) AND ` +
  `(${a}.dan > ${b}.dan OR (${a}.dan = ${b}.dan AND (${a}.cleared > ${b}.cleared OR ` +
  `(${a}.cleared = ${b}.cleared AND ${a}.record_score > ${b}.record_score))))))`;

/** ランキングの 1 行の成績 */
export type RankedRecord = RecordedSummary & { dan: number; character: string };

export interface RankingEntry extends RankedRecord {
  rank: number;
  name: string;
  isMe: boolean;
}

export interface Ranking {
  week: string;
  entries: RankingEntry[];
  /** 本人のその週の最高記録。名前を公開していなければ rank は null（ランキングには載らない） */
  me: (RankedRecord & { rank: number | null }) | null;
}

const RECORD_COLUMNS = 'b.dan, b.character, b.missions, b.cleared, b.total_score, b.record_score';

function recordOf(r: Record<string, unknown>): RankedRecord {
  const who = { dan: Number(r.dan), character: String(r.character) };
  if (r.missions == null) {
    return { ...who, missions: null, cleared: false, times: 1, totalScore: Number(r.total_score), recordScore: Number(r.record_score) };
  }
  return { ...who, ...summaryOf(JSON.parse(String(r.missions)) as MissionResult[], !!r.cleared, Number(r.total_score)) };
}

export async function weeklyRanking(db: D1Database, week: string, accountId: string): Promise<Ranking> {
  const [top, mine] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT RANK() OVER (ORDER BY ${rankingOrder('b')}) AS rank, p.display_name AS name,
           ${RECORD_COLUMNS}, b.account_id = ? AS is_me
         FROM weekly_best b JOIN profiles p ON p.account_id = b.account_id
         WHERE b.week = ?
         ORDER BY ${rankingOrder('b')}, b.finished_at ASC
         LIMIT ?`,
      )
      .bind(accountId, week, RANKING_SIZE),
    db
      .prepare(
        `SELECT ${RECORD_COLUMNS},
           EXISTS (SELECT 1 FROM profiles WHERE account_id = b.account_id) AS named,
           (SELECT COUNT(*) FROM weekly_best o JOIN profiles op ON op.account_id = o.account_id
            WHERE o.week = b.week AND ${betterThan('o', 'b')}) + 1 AS rank
         FROM weekly_best b WHERE b.week = ? AND b.account_id = ?`,
      )
      .bind(week, accountId),
  ]);
  const entries = top.results.map((r) => ({
    ...recordOf(r),
    rank: Number(r.rank),
    name: String(r.name),
    isMe: !!r.is_me,
  }));
  const m = mine.results[0];
  return { week, entries, me: m ? { ...recordOf(m), rank: m.named ? Number(m.rank) : null } : null };
}
