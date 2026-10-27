/**
 * 途中のランとルール設定の保存（localStorage）。
 *
 * ランは状態ではなく操作ログ（engine の RunLog）で保存し、読み込むときに replay() で作り直す。
 * 保存先は小さなインターフェース越しに触る（テストで差し替えられるように。TAKO-SEN の core/storage.ts と同じ形）。
 * 保存先が使えないとき（Safari のプライベートモード、容量超過など）も、遊ぶことはできるようにする。
 */
import { DEFAULT_BASE_RULES, type BaseRules, type RunLog } from '@pujan/engine';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RUN_KEY = 'pujan.run.v1';
const RULES_KEY = 'pujan.rules.v1';

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

/** ルール設定（巡数・保留枠・ネクスト・赤牌・海底）。足りない項目は既定値で埋める */
export function loadRules(storage: KeyValueStorage | null): BaseRules {
  const v = read(storage, RULES_KEY) as Partial<BaseRules> | null;
  const r = { ...DEFAULT_BASE_RULES };
  if (!v) return r;
  if (typeof v.turns === 'number') r.turns = v.turns;
  if (typeof v.holdSlots === 'number') r.holdSlots = v.holdSlots;
  if (typeof v.next === 'number') r.next = v.next;
  if (typeof v.redFives === 'boolean') r.redFives = v.redFives;
  if (typeof v.haitei === 'boolean') r.haitei = v.haitei;
  return r;
}

export function saveRules(storage: KeyValueStorage | null, rules: BaseRules): void {
  write(storage, RULES_KEY, rules);
}
