/**
 * プレイの集計（docs/SPEC.md フェーズ 4.5）。記録したランの操作ログを再生して、バランスの調整に使う数を出す。
 * D1 から読むのは backend/scripts/stats.mjs。ここは純粋な計算だけで、個人が分かる値は扱わない。
 */
import { BOSSES } from './items.js';
import { isFinished, replay, type GameState, type RunLog } from './game.js';
import { startLabel } from './progression.js';
import { WAVE_COUNT, offerName, runSummary } from './run.js';

/** 終わった 1 つのランから数えたもの */
export interface RunStats {
  /** 雀士と段位（「くま・初段」） */
  start: string;
  /** 突破した場の数（4 は全場クリア） */
  wavesCleared: number;
  /** 負けた場のボスの名前（全場クリアでは null） */
  lostBoss: string | null;
  kyoku: number;
  wins: number;
  /** 和了った役の名前（和了ごとに、その和了の役をすべて） */
  yaku: string[];
  /** ショップに並んだ品（並んだ回数ぶん） */
  shown: string[];
  bought: string[];
  /** 福引きの景品（回した回数ぶん。はずれは GACHA_MISS）。福引きを足す前に記録したランには無い */
  gacha?: string[];
}

/** 集計での福引きのはずれの名前 */
export const GACHA_MISS = 'はずれ';

/**
 * 操作ログを再生し、最後の状態と、数えたもの（ランが終わっていなければ null）を返す。
 * サーバーは記録するときにこれで 1 回だけ再生し、数えたものも残す（版を上げたあとも前の版のランを集計できるように）。
 * 版が違う・再生できないログは replay() と同じく例外を投げる
 */
export function replayWithStats(log: RunLog): { game: GameState; stats: RunStats | null } {
  const s = { kyoku: 0, wins: 0, yaku: [] as string[], shown: [] as string[], bought: [] as string[], gacha: [] as string[] };
  const g = replay(log, (before, action, after) => {
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
  const boss = g.run.phase === 'over' ? g.run.round.boss : null;
  return {
    game: g,
    stats: {
      start: startLabel(log.start),
      wavesCleared: runSummary(g.run).wavesCleared,
      lostBoss: boss && (BOSSES.find((b) => b.id === boss)?.name ?? boss),
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

/** 集計の結果 */
export interface PlayStats {
  runs: number;
  /** 雀士と段位ごとのラン数・全場クリア数・突破した場の合計 */
  byStart: Record<string, { runs: number; cleared: number; waves: number }>;
  /** ラン終了で負けた場ごとの数（東・南・西・北） */
  lostAt: number[];
  /** 負けた場のボスごとの数 */
  lostBoss: Record<string, number>;
  kyoku: number;
  wins: number;
  /** 役ごとの和了の数 */
  yaku: Record<string, number>;
  /** 品ごとの、並んだ回数と買われた回数 */
  shop: Record<string, { shown: number; bought: number }>;
  /** 福引きの景品ごとの数（はずれは GACHA_MISS） */
  gacha: Record<string, number>;
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

export function aggregate(runs: readonly RunStats[]): PlayStats {
  const out: PlayStats = {
    runs: runs.length,
    byStart: {},
    lostAt: Array<number>(WAVE_COUNT).fill(0),
    lostBoss: {},
    kyoku: 0,
    wins: 0,
    yaku: {},
    shop: {},
    gacha: {},
  };
  for (const r of runs) {
    const s = (out.byStart[r.start] ??= { runs: 0, cleared: 0, waves: 0 });
    s.runs++;
    s.waves += r.wavesCleared;
    if (r.wavesCleared >= WAVE_COUNT) s.cleared++;
    else out.lostAt[r.wavesCleared]++;
    if (r.lostBoss) bump(out.lostBoss, r.lostBoss);
    out.kyoku += r.kyoku;
    out.wins += r.wins;
    for (const y of r.yaku) bump(out.yaku, y);
    for (const name of r.shown) (out.shop[name] ??= { shown: 0, bought: 0 }).shown++;
    for (const name of r.bought) (out.shop[name] ??= { shown: 0, bought: 0 }).bought++;
    for (const name of r.gacha ?? []) bump(out.gacha, name);
  }
  return out;
}
