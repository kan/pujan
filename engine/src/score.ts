/**
 * 点数計算。仕様は docs/SPEC.md §3.4「点数」。
 *
 * 翻ごとに倍（100×2^翻）で、4 翻 1,600 点まで。5 翻からは満貫などの上限で頭打ちにする。
 * お守り「青天井」があると上限がなくなる。
 */
import type { Evaluation } from './hand.js';

export const YAKUMAN_POINTS = 8000;

export const LIMITS: readonly { minHan: number; points: number; name: string }[] = [
  { minHan: 13, points: 8000, name: '数え役満' },
  { minHan: 11, points: 6000, name: '三倍満' },
  { minHan: 8, points: 4000, name: '倍満' },
  { minHan: 6, points: 3000, name: '跳満' },
  { minHan: 5, points: 2000, name: '満貫' },
];

export function pointsOfHan(han: number, noLimit = false): number {
  if (han < 5 || noLimit) return 100 * 2 ** han;
  return LIMITS.find((l) => han >= l.minHan)!.points;
}

export function limitName(han: number, noLimit = false): string | null {
  if (han < 5 || noLimit) return null;
  return LIMITS.find((l) => han >= l.minHan)!.name;
}

/** 役と翻だけから決まる基本点（親・本場・役レベルなどを掛ける前） */
export function basePoints(ev: Evaluation, noLimit = false): number {
  return ev.yakuman ? YAKUMAN_POINTS * ev.yakuman : pointsOfHan(ev.han, noLimit);
}

/** 和了の点数を決める局と持ち物の情報 */
export interface FinalizeContext {
  noLimit: boolean;
  /** 役の巻物のレベル（役名 → レベル） */
  yakuLevels: Readonly<Record<string, number>>;
  /** 安手の美学: 役なしの和了が 4 倍 */
  cheapHandTimes4: boolean;
  dealer: boolean;
  /** 親の倍率（通常 1.5、親父の背中で 2） */
  dealerMultiplier: number;
  /** リーチ宣言から和了までの巡数（リーチしていなければ 0） */
  riichiTurns: number;
  /** リーチ後 1 巡あたりのボーナス（通常 100、博打打ちで 200） */
  riichiBonusPerTurn: number;
  honba: number;
  /** 1 本場あたりのボーナス（通常 100、居座りで 300） */
  honbaBonus: number;
}

export interface ScoreLine {
  label: string;
  /** 表示用の値（「3翻」「×1.5」「+200」など） */
  value: string;
}

export interface FinalScore {
  points: number;
  lines: ScoreLine[];
}

const roundUp100 = (n: number) => Math.ceil(n / 100) * 100;

export function finalizeScore(ev: Evaluation, ctx: FinalizeContext): FinalScore {
  const lines: ScoreLine[] = ev.yaku.map((y) => ({
    label: y.name,
    value: y.yakuman ? (y.yakuman === 2 ? 'ダブル役満' : '役満') : `${y.han}翻`,
  }));
  if (ev.noYaku) lines.unshift({ label: '役なし', value: '' });
  let points = basePoints(ev, ctx.noLimit);
  const limit = ev.yakuman ? null : limitName(ev.han, ctx.noLimit);
  if (limit) lines.push({ label: limit, value: `${points.toLocaleString('ja-JP')}点` });

  let levelTimes = 1;
  for (const y of ev.yaku) levelTimes *= 1.5 ** (ctx.yakuLevels[y.name] ?? 0);
  if (levelTimes > 1) {
    points = Math.round((points * levelTimes) / 100) * 100;
    lines.push({ label: '役レベル', value: `×${+levelTimes.toFixed(2)}` });
  }
  if (ev.noYaku && ctx.cheapHandTimes4) {
    points *= 4;
    lines.push({ label: '安手の美学', value: '×4' });
  }
  if (ctx.dealer) {
    points = roundUp100(points * ctx.dealerMultiplier);
    lines.push({ label: '親', value: `×${ctx.dealerMultiplier}` });
  }
  if (ctx.riichiTurns > 0) {
    const bonus = ctx.riichiTurns * ctx.riichiBonusPerTurn;
    points += bonus;
    lines.push({ label: `リーチ後${ctx.riichiTurns}巡`, value: `+${bonus}` });
  }
  if (ctx.honba > 0) {
    const bonus = ctx.honba * ctx.honbaBonus;
    points += bonus;
    lines.push({ label: `${ctx.honba}本場`, value: `+${bonus}` });
  }
  return { points, lines };
}
