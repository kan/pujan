/**
 * プレイの集計（docs/SPEC.md フェーズ 4.5）。記録したランの操作ログを再生して、バランスの調整に使う数を出す。
 * D1 から読むのは backend/scripts/stats.mjs。ここは純粋な計算だけで、個人が分かる値は扱わない。
 */
import { BOSSES } from './items.js';
import { isFinished, replay, type GameState, type RunLog } from './game.js';
import { missionKey, timesLabel } from './mission.js';
import { startLabel } from './progression.js';
import { offerName, runSummary } from './run.js';

/** 終わった 1 つのランから数えたもの（東風戦。ルールの版 11 から） */
export interface RunStats {
  /** 雀士と段位（「くま・初段」） */
  start: string;
  /** 掲げたお題（種類と段は「回数・段2」。mission.ts の missionKey）と、果たしたか */
  missions: { key: string; times: number; met: boolean }[];
  cleared: boolean;
  /** 記録点に掛けた倍率（果たしたお題の倍率の合計。クリアしなければ 1） */
  times: number;
  /** 4 局の合計点 */
  totalScore: number;
  /** オーラスのボスの名前 */
  boss: string;
  kyoku: number;
  wins: number;
  /** 和了った役の名前（和了ごとに、その和了の役をすべて） */
  yaku: string[];
  /** ショップに並んだ品（並んだ回数ぶん） */
  shown: string[];
  bought: string[];
  /** 福引きの景品（回した回数ぶん。はずれは GACHA_MISS）。福引きを足す前に記録したランには無い */
  gacha?: string[];
  /** 祝儀を払って巡を延ばした回数。延長を足す前のランには無い */
  extends?: number;
  /** 延長札を使って巡を延ばした回数（買っただけで使わなかった延長札は数えない）。延長を足す前のランには無い */
  extendTickets?: number;
}

/** 集計での福引きのはずれの名前 */
export const GACHA_MISS = 'はずれ';

/**
 * 操作ログを再生し、最後の状態と、数えたもの（ランが終わっていなければ null）を返す。
 * サーバーは記録するときにこれで 1 回だけ再生し、数えたものも残す（版を上げたあとも前の版のランを集計できるように）。
 * 版が違う・再生できないログは replay() と同じく例外を投げる
 */
export function replayWithStats(log: RunLog): { game: GameState; stats: RunStats | null } {
  const s = { kyoku: 0, wins: 0, yaku: [] as string[], shown: [] as string[], bought: [] as string[], gacha: [] as string[], extends: 0, extendTickets: 0 };
  const g = replay(log, (before, action, after) => {
    if (action.type === 'extend') s.extends++;
    if (action.type === 'useConsumable' && before.run.consumables[action.index] === 'encho') s.extendTickets++;
    if (action.type === 'buy') {
      const offer = before.run.shop?.[action.index];
      if (offer) s.bought.push(offerName(offer));
    }
    if (action.type === 'gacha') {
      const prize = after.run.gacha!.prize;
      s.gacha.push(prize ? offerName(prize) : GACHA_MISS);
    }
    const result = action.type === 'settle' ? before.kyoku?.result : null;
    if (result) {
      s.kyoku++;
      if (result.type === 'win') {
        s.wins++;
        s.yaku.push(...result.win.evaluation.yaku.map((y) => y.name));
      }
    }
    // 品が並ぶのは、ショップに入ったときと品替えのとき
    if (after.run.shop && (action.type === 'reroll' || before.run.phase !== 'shop')) {
      s.shown.push(...after.run.shop.map(offerName));
    }
  });
  if (!isFinished(g)) return { game: g, stats: null };
  const summary = runSummary(g.run);
  const boss = g.run.round.boss;
  return {
    game: g,
    stats: {
      start: startLabel(log.start),
      missions: summary.missions.map((m) => ({ key: missionKey(m), times: m.times, met: m.met })),
      cleared: summary.cleared,
      times: summary.times,
      totalScore: summary.totalScore,
      boss: BOSSES.find((b) => b.id === boss)?.name ?? boss,
      ...s,
    },
  };
}

/** 終わったランの操作ログを再生して数える。版が違う・再生できない・終わっていないログは null */
export function analyzeRun(log: RunLog): RunStats | null {
  try {
    return replayWithStats(log).stats;
  } catch {
    return null;
  }
}

/** ラン数・クリア数・合計点の和 */
export interface ClearCount {
  runs: number;
  cleared: number;
  score: number;
}

/** 集計の結果 */
export interface PlayStats {
  runs: number;
  /** 雀士と段位ごと */
  byStart: Record<string, ClearCount>;
  /** お題の種類と段ごと（runs は掲げた数、cleared は果たした数、score はそのランの合計点の和） */
  byMission: Record<string, ClearCount>;
  /** お題の倍率の枠ごと（「×1.5」。数え方は byMission と同じ） */
  byTimes: Record<string, ClearCount>;
  /** 1 ランで果たしたお題の数ごとのラン数（「0」〜「3」） */
  byMetCount: Record<string, number>;
  /** オーラスのボスごと */
  byBoss: Record<string, ClearCount>;
  kyoku: number;
  wins: number;
  /** 役ごとの和了の数 */
  yaku: Record<string, number>;
  /** 品ごとの、並んだ回数と買われた回数 */
  shop: Record<string, { shown: number; bought: number }>;
  /** 福引きの景品ごとの数（はずれは GACHA_MISS） */
  gacha: Record<string, number>;
  /** 祝儀を払って巡を延ばした回数 */
  extends: number;
  /** 延長札を使って巡を延ばした回数 */
  extendTickets: number;
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

/** cleared はクリアしたか（お題ごとに数えるときは、そのお題を果たしたか） */
const count = (m: Record<string, ClearCount>, k: string, r: RunStats, cleared = r.cleared) => {
  const c = (m[k] ??= { runs: 0, cleared: 0, score: 0 });
  c.runs++;
  if (cleared) c.cleared++;
  c.score += r.totalScore;
};

export function aggregate(runs: readonly RunStats[]): PlayStats {
  const out: PlayStats = {
    runs: runs.length,
    byStart: {},
    byMission: {},
    byTimes: {},
    byMetCount: {},
    byBoss: {},
    kyoku: 0,
    wins: 0,
    yaku: {},
    shop: {},
    gacha: {},
    extends: 0,
    extendTickets: 0,
  };
  for (const r of runs) {
    count(out.byStart, r.start, r);
    for (const m of r.missions) {
      count(out.byMission, m.key, r, m.met);
      count(out.byTimes, timesLabel(m.times), r, m.met);
    }
    bump(out.byMetCount, String(r.missions.filter((m) => m.met).length));
    count(out.byBoss, r.boss, r);
    out.kyoku += r.kyoku;
    out.wins += r.wins;
    for (const y of r.yaku) bump(out.yaku, y);
    for (const name of r.shown) (out.shop[name] ??= { shown: 0, bought: 0 }).shown++;
    for (const name of r.bought) (out.shop[name] ??= { shown: 0, bought: 0 }).bought++;
    for (const name of r.gacha ?? []) bump(out.gacha, name);
    out.extends += r.extends ?? 0;
    out.extendTickets += r.extendTickets ?? 0;
  }
  return out;
}
