/**
 * ランの開始と記録（docs/SPEC.md §5.3）。
 *
 * ランのシードはサーバーが渡す（良い山を手元で探してから遊ぶ不正を防ぐ）。進めていられるランは 1 つの ID につき 1 つで、
 * 新しいランを始めると前のランは記録できなくなる。終わったら操作ログを送ってもらい、同じ engine で再生して成績を出す。
 */
import {
  ENGINE_VERSION,
  isFinished,
  makeStart,
  progressAfter,
  randomSeed,
  replay,
  runSummary,
  sameStart,
  weekOf,
  type Progress,
  type RunLog,
  type RunStart,
  type RunSummary,
} from '@pujan/engine';
import { loadProgress, progressOfRow, upsertProgress, type ProgressRow } from './progress';
import { betterThan } from './ranking';

/** 受け付ける操作の数の上限（ふつうのランは数百手。再生にかかる時間を抑える）。API の本文の検査で使う */
export const MAX_ACTIONS = 5000;

export interface StartedRun {
  id: string;
  seed: number;
  engineVersion: number;
  /** 始めの条件（解禁済みの役はサーバーの記録から入れる）。画面はこの条件でランを始める */
  start: RunStart;
}

/**
 * ランを始める。雀士と段位は、その ID の解禁の状態で選べるものだけ（選べなければ null）。
 * 解禁済みの役（ショップに並ぶ巻物など）はサーバーの記録から決める
 */
export async function startRun(
  db: D1Database,
  accountId: string,
  choice: { character: string; dan: number },
  now = Date.now(),
): Promise<StartedRun | null> {
  const start = makeStart(await loadProgress(db, accountId), choice.character, choice.dan);
  if (!start) return null;
  const run = { id: crypto.randomUUID(), seed: randomSeed(), engineVersion: ENGINE_VERSION, start };
  await db.batch([
    // 終わっていない前のランは、もう記録できないので消す（1 つの ID の行が増え続けないように）
    db.prepare('DELETE FROM runs WHERE account_id = ? AND finished_at IS NULL').bind(accountId),
    db
      .prepare('INSERT INTO runs (id, account_id, seed, engine_version, start, started_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(run.id, accountId, run.seed, run.engineVersion, JSON.stringify(start), now),
  ]);
  return run;
}

export type FinishResult =
  /** duplicate: 同じランの記録の再送（成績は最初のもの）。progress は記録したあとの解禁の状態 */
  | { status: 'recorded'; summary: RunSummary; week: string; best: boolean; duplicate: boolean; progress: Progress }
  /** ランがない（ほかの ID のラン、または新しいランを始めたので消えた前のラン） */
  | { status: 'not_found' }
  /** その ID のいちばん新しいランではない（新しいランを始めたあと。前のランは startRun が消すので、ふつうは not_found になる） */
  | { status: 'superseded' }
  /** ランを始めたときと engine の版が違う */
  | { status: 'version_mismatch' }
  /** ログがこのランのものでない、再生できない、ランが終わっていない */
  | { status: 'invalid'; reason: string };

interface RunRow extends ProgressRow {
  account_id: string;
  seed: number;
  engine_version: number;
  /** 始めの条件（RunStart の JSON） */
  start: string;
  started_at: number;
  finished_at: number | null;
  waves_cleared: number | null;
  total_score: number | null;
  /** その ID のいちばん新しいランの ID */
  latest_id: string;
  /** このランがその週の最高記録か（終わったランのとき） */
  is_best: number;
}

/** 終わったランの操作ログを再生して確かめ、成績と週の最高記録を書く */
export async function finishRun(
  db: D1Database,
  accountId: string,
  runId: string,
  log: RunLog,
  now = Date.now(),
): Promise<FinishResult> {
  const row = await db
    .prepare(
      `SELECT r.account_id, r.seed, r.engine_version, r.start, r.started_at, r.finished_at, r.waves_cleared, r.total_score,
         (SELECT id FROM runs WHERE account_id = r.account_id ORDER BY started_at DESC, id DESC LIMIT 1) AS latest_id,
         EXISTS (SELECT 1 FROM weekly_best WHERE account_id = r.account_id AND run_id = r.id) AS is_best,
         p.yaku_won, p.best_waves, p.dan_cleared
       FROM runs r LEFT JOIN progress p ON p.account_id = r.account_id WHERE r.id = ?`,
    )
    .bind(runId)
    .first<RunRow>();
  if (!row || row.account_id !== accountId) return { status: 'not_found' };

  const before = progressOfRow(row);
  if (row.finished_at !== null) {
    const summary = { wavesCleared: row.waves_cleared!, totalScore: row.total_score! };
    return { status: 'recorded', summary, week: weekOf(row.started_at), best: !!row.is_best, duplicate: true, progress: before };
  }
  if (row.latest_id !== runId) return { status: 'superseded' };
  if (log.engineVersion !== row.engine_version || row.engine_version !== ENGINE_VERSION) return { status: 'version_mismatch' };
  if (log.seed !== row.seed) return { status: 'invalid', reason: 'seed' };
  // 雀士・段位・解禁済みの役は、始めたときにサーバーが渡したものと同じでなければならない
  if (!log.start || !sameStart(JSON.parse(row.start) as RunStart, log.start)) return { status: 'invalid', reason: 'start' };

  let summary: RunSummary;
  let progress: Progress;
  try {
    const game = replay(log);
    if (!isFinished(game)) return { status: 'invalid', reason: 'not_finished' };
    summary = runSummary(game.run);
    progress = progressAfter(before, game.run);
  } catch (e) {
    return { status: 'invalid', reason: `replay: ${(e as Error).message}` };
  }

  // 週は始めた時刻（サーバーの時刻）で決める。送った時刻で決めると、オフラインで遊んで週が変わってから送った記録が
  // 次の週に入り、送る時期を選んで記録を載せる週を選べてしまう
  const week = weekOf(row.started_at);
  const [, best] = await db.batch([
    // finished_at IS NULL: 同時に届いた 2 回目の送信は成績を書き換えない
    db
      .prepare('UPDATE runs SET finished_at = ?, waves_cleared = ?, total_score = ? WHERE id = ? AND finished_at IS NULL')
      .bind(now, summary.wavesCleared, summary.totalScore, runId),
    // 週の最高記録より良ければ置き換える（ランキングと同じ規則）
    db
      .prepare(
        `INSERT INTO weekly_best (week, account_id, run_id, dan, character, waves_cleared, total_score, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (week, account_id) DO UPDATE SET
           run_id = excluded.run_id, dan = excluded.dan, character = excluded.character,
           waves_cleared = excluded.waves_cleared, total_score = excluded.total_score, finished_at = excluded.finished_at
         WHERE ${betterThan('excluded', 'weekly_best')}
         RETURNING run_id`,
      )
      .bind(week, accountId, runId, log.start.dan, log.start.character, summary.wavesCleared, summary.totalScore, now),
    // 解禁は減らないので、同時の送信があっても和を取って書く
    upsertProgress(db, accountId, progress, now),
  ]);
  return { status: 'recorded', summary, week, best: best.results.length > 0, duplicate: false, progress };
}
