/**
 * 途中のランなどの保存（localStorage）。
 *
 * ランは状態ではなく操作ログ（engine の RunLog）で保存し、読み込むときに replay() で作り直す。
 * 保存先は小さなインターフェース越しに触る（テストで差し替えられるように。TAKO-SEN の core/storage.ts と同じ形）。
 * 保存先が使えないとき（Safari のプライベートモード、容量超過など）も、遊ぶことはできるようにする。
 */
import {
  EMPTY_PROGRESS,
  parseProgress,
  isRunChoice,
  isRunStart,
  type Progress,
  type RunChoice,
  type RunLog,
} from '@pujan/engine';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RUN_KEY = 'pujan.run.v1';
const RUN_ID_KEY = 'pujan.run-id.v1';
const PENDING_KEY = 'pujan.pending.v1';
const SETTLED_KEY = 'pujan.settled.v1';
const TUTORIAL_KEY = 'pujan.tutorial-seen.v1';
/**
 * 解禁の状態。v2 から雀士の一覧（characters）を持つ。v1 は一覧を持たない前の形で、v2 がないときだけ読む
 * （キャッシュに残った古い画面が v1 に一覧なしで書き戻しても、v2 の一覧を失わないように分ける）
 */
const PROGRESS_KEY = 'pujan.progress.v2';
const LEGACY_PROGRESS_KEY = 'pujan.progress.v1';
const CHOICE_KEY = 'pujan.choice.v1';
const SENT_FEEDBACK_KEY = 'pujan.sent-feedback.v1';

/** 送れなかった記録を持っておく数（古いものから捨てる） */
const MAX_PENDING = 5;
/** 送った感想を覚えておく数（古いものから捨てる） */
export const MAX_SENT_FEEDBACK = 20;

/** localStorage。触るだけで例外を投げる環境があるので、そのときは null */
export function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: KeyValueStorage | null, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(storage: KeyValueStorage | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても遊べるようにする
  }
}

/** 保存してある操作ログ。形が合わなければ null（操作の中身の正しさは replay() が確かめる） */
export function loadRunLog(storage: KeyValueStorage | null): RunLog | null {
  const v = read(storage, RUN_KEY) as Partial<RunLog> | null;
  if (!v || typeof v.seed !== 'number' || typeof v.engineVersion !== 'number' || !Array.isArray(v.actions)) return null;
  // 始めの条件が欠けたログ（雀士と段位ができる前のログなど）は読まない
  if (!isRunStart(v.start)) return null;
  return v as RunLog;
}

export function saveRunLog(storage: KeyValueStorage | null, log: RunLog): void {
  write(storage, RUN_KEY, log);
}

export function clearRunLog(storage: KeyValueStorage | null): void {
  try {
    storage?.removeItem(RUN_KEY);
  } catch {
    // 消せなくても次の保存で上書きされる
  }
}

/** 今のランをランキングに載せるときの、サーバーのランの ID（端末だけのランでは null） */
export function loadRunId(storage: KeyValueStorage | null): string | null {
  const v = read(storage, RUN_ID_KEY);
  return typeof v === 'string' ? v : null;
}

export function saveRunId(storage: KeyValueStorage | null, runId: string | null): void {
  write(storage, RUN_ID_KEY, runId);
}

/** 記録が済んだ（または断られた）ランの ID。開き直したときに同じランを送り直さないため */
export function loadSettledRunId(storage: KeyValueStorage | null): string | null {
  const v = read(storage, SETTLED_KEY);
  return typeof v === 'string' ? v : null;
}

export function saveSettledRunId(storage: KeyValueStorage | null, runId: string): void {
  write(storage, SETTLED_KEY, runId);
}

/** 送れなかった記録（オフラインなど）。次に開いたときやオンラインに戻ったときに送り直す */
export interface PendingRun {
  runId: string;
  log: RunLog;
}

export function loadPending(storage: KeyValueStorage | null): PendingRun[] {
  const v = read(storage, PENDING_KEY);
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is PendingRun => typeof p?.runId === 'string' && Array.isArray(p?.log?.actions));
}

export function savePending(storage: KeyValueStorage | null, pending: readonly PendingRun[]): void {
  write(storage, PENDING_KEY, pending.slice(-MAX_PENDING));
}

/** チュートリアルを一度でも開いた（または「あとで」を選んだ）。初めて開いたときだけ、見るかどうかを聞く */
export function loadTutorialSeen(storage: KeyValueStorage | null): boolean {
  return read(storage, TUTORIAL_KEY) === true;
}

export function saveTutorialSeen(storage: KeyValueStorage | null): void {
  write(storage, TUTORIAL_KEY, true);
}

/**
 * 端末に覚えている解禁の状態。サーバーの記録と端末だけのランの結果を足し合わせたもの
 * （ランキングに載るランの始めの条件は、サーバーの記録で決まる）
 */
export function loadProgress(storage: KeyValueStorage | null): Progress {
  // v1（雀士の一覧を持たない前の形）は parseProgress が今の形にする
  return parseProgress(read(storage, PROGRESS_KEY) ?? read(storage, LEGACY_PROGRESS_KEY)) ?? EMPTY_PROGRESS;
}

export function saveProgress(storage: KeyValueStorage | null, p: Progress): void {
  write(storage, PROGRESS_KEY, p);
}

/**
 * 前のランで選んだ雀士と段位（次のランの準備で、はじめから選んでおく）。形が違えば標準・初段。
 * 今の解禁の状態で選べるかは、使う側が clampChoice で収める
 */
export function loadChoice(storage: KeyValueStorage | null): RunChoice {
  const v = read(storage, CHOICE_KEY);
  return isRunChoice(v) ? { character: v.character, dan: v.dan } : { character: 'standard', dan: 0 };
}

export function saveChoice(storage: KeyValueStorage | null, choice: RunChoice): void {
  write(storage, CHOICE_KEY, choice);
}

/** この端末から送った感想（感想の画面で見返す）。サーバーには問い合わせない */
export interface SentFeedback {
  body: string;
  /** 送った日時（ミリ秒） */
  sentAt: number;
  /** 一緒に送ったものの説明（contextText） */
  context: string;
}

/** 送った順。形の違うものは捨てる */
export function loadSentFeedback(storage: KeyValueStorage | null): SentFeedback[] {
  const v = read(storage, SENT_FEEDBACK_KEY);
  if (!Array.isArray(v)) return [];
  return v.filter(
    (f): f is SentFeedback =>
      typeof f?.body === 'string' && typeof f?.sentAt === 'number' && typeof f?.context === 'string',
  );
}

export function addSentFeedback(storage: KeyValueStorage | null, f: SentFeedback): void {
  write(storage, SENT_FEEDBACK_KEY, [...loadSentFeedback(storage), f].slice(-MAX_SENT_FEEDBACK));
}
