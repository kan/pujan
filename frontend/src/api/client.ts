/**
 * API の呼び出し（docs/SPEC.md §5）。ID は kan-game.app の HttpOnly の Cookie にあり、/api への要求に自動で付く。
 * 画面はトークンを持たない（kan/game docs/ID_DESIGN.md）。
 *
 * ID は起動時に POST /api/id/session でもらう（なければ発行、あれば延長）。
 * API が 410（退会した ID）を返したら、ID をもらい直してもう一度だけ送る。
 */
import type { Progress, RunChoice, RunLog, RunStart, RunSummary } from '@pujan/engine';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

/** ID のセッション。name は kan-game.app の名前（ほかのゲームで登録したものを含む。なければ null） */
export interface Session {
  name: string | null;
}

let session: Promise<Session | null> | undefined;

/** ID をもらう（起動時に 1 回。つながらなければ null で、次の呼び出しでやり直す） */
export function ensureId(): Promise<Session | null> {
  if (session) return session;
  const current: Promise<Session | null> = askSession().then((s) => {
    // つながらなければ次の呼び出しでやり直す（そのあいだに作り直されていたら、それを消さない）
    if (!s && session === current) session = undefined;
    return s;
  });
  session = current;
  return current;
}

/** ID のセッションを待つ上限。つながりが悪いときに、画面を待たせ続けない */
const SESSION_TIMEOUT_MS = 5000;

async function askSession(): Promise<Session | null> {
  const ask = () => fetch('/api/id/session', { method: 'POST', signal: AbortSignal.timeout(SESSION_TIMEOUT_MS) });
  try {
    let res = await ask();
    // 退会した ID: この応答が Cookie を消したので、もう一度呼ぶと新しい ID になる（kan/game src/session.ts）
    if (res.status === 410) res = await ask();
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
    return { name: typeof body?.name === 'string' ? body.name : null };
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const current = ensureId();
  if (!(await current)) throw new ApiError(0, 'offline');
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: init.body ? { 'Content-Type': 'application/json' } : undefined });
  } catch {
    throw new ApiError(0, 'offline');
  }
  if (res.status === 410 && !retried) {
    // ID をもらい直す（同時に 410 を受けたほかの要求と、もらい直しを 1 回にまとめる）
    if (session === current) session = undefined;
    return request(path, init, true);
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'error');
  return body as T;
}

const post = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), signal });

export interface Me {
  id: string;
  /** ランキングに出す名前（公開に同意する前は null） */
  name: string | null;
  /** サーバーに記録した解禁の状態 */
  progress: Progress;
}

export interface StartedRun {
  id: string;
  seed: number;
  engineVersion: number;
  /** 始めの条件（解禁済みの役はサーバーの記録から） */
  start: RunStart;
}

export interface FinishedRun extends RunSummary {
  week: string;
  /** その週の最高記録になった */
  best: boolean;
  /** 記録したあとの解禁の状態 */
  progress: Progress;
}

/** ランキングの 1 行の成績（段位 → 突破した場の数 → 合計点の順。雀士は表示だけ） */
type RankedSummary = RunSummary & { dan: number; character: string };

export interface WeeklyRanking {
  week: string;
  entries: (RankedSummary & { rank: number; name: string; isMe: boolean })[];
  me: (RankedSummary & { rank: number | null }) | null;
}

/** ランの開始を待つ上限。つながりが悪いときは、待たせずに端末だけのランで始める */
const START_TIMEOUT_MS = 3000;
/** 記録を送るのを待つ上限（サーバーは操作ログを再生するので、少し長めに待つ）。超えたら送り直し待ちにする */
const FINISH_TIMEOUT_MS = 15000;

export const api = {
  me: () => request<Me>('/api/me'),
  registerName: (name: string) => post<{ name: string }>('/api/profile', { name }),
  startRun: (choice: RunChoice) => post<StartedRun>('/api/runs', choice, AbortSignal.timeout(START_TIMEOUT_MS)),
  finishRun: (runId: string, log: RunLog) =>
    post<FinishedRun>(`/api/runs/${encodeURIComponent(runId)}/finish`, { log }, AbortSignal.timeout(FINISH_TIMEOUT_MS)),
  weeklyRanking: (week?: string) =>
    request<WeeklyRanking>(`/api/rankings/weekly${week ? `?week=${encodeURIComponent(week)}` : ''}`),
};
