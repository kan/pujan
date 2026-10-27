/**
 * 途中のランなどの保存（localStorage）。
 *
 * ランは状態ではなく操作ログ（engine の RunLog）で保存し、読み込むときに replay() で作り直す。
 * 保存先は小さなインターフェース越しに触る（テストで差し替えられるように。TAKO-SEN の core/storage.ts と同じ形）。
 * 保存先が使えないとき（Safari のプライベートモード、容量超過など）も、遊ぶことはできるようにする。
 */
import type { BaseRules, RunLog } from '@pujan/engine';

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

/** 送れなかった記録を持っておく数（古いものから捨てる） */
const MAX_PENDING = 5;

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

function isBaseRules(v: unknown): v is BaseRules {
  const b = v as Partial<BaseRules> | null;
  return (
    !!b &&
    Number.isInteger(b.turns) &&
    Number.isInteger(b.holdSlots) &&
    Number.isInteger(b.next) &&
    typeof b.redFives === 'boolean' &&
    typeof b.haitei === 'boolean'
  );
}

/** 保存してある操作ログ。形が合わなければ null（操作の中身の正しさは replay() が確かめる） */
export function loadRunLog(storage: KeyValueStorage | null): RunLog | null {
  const v = read(storage, RUN_KEY) as Partial<RunLog> | null;
  if (!v || typeof v.seed !== 'number' || typeof v.engineVersion !== 'number' || !Array.isArray(v.actions)) return null;
  // 基本ルールの項目が欠けたログは、再生できても壊れたランになるので読まない
  if (!isBaseRules(v.base)) return null;
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
