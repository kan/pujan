/**
 * お題（docs/SPEC.md §4.1）。ランの始めに 3 つ（雀聖は 2 つ）を同時に掲げ、東風戦（東 1〜4 局）を通して果たす。
 * 1 つ以上果たせばクリア。
 *
 * 種類は回数・点数・役の 3 つで、それぞれに重さの段（1〜5）がある。お題の枠ごとに倍率が決まっていて、
 * クリアしたときは、果たしたお題の倍率の合計を 4 局の合計点に掛けて記録点にする。段位が上がると、同じ枠でも段が上がる。
 */
import { nextInt } from './rng.js';

/**
 * 役満で和了ったときに、和了った役の一覧（yakuWon）へ役の名前と一緒に入れる印。
 * 役満の名前を並べた一覧を持たずに、役満のお題と雀士「ねこ」（役満型）の解禁を判定するため
 */
export const YAKUMAN_MARK = '役満';

export type MissionKind = 'wins' | 'points' | 'yaku';

export interface Mission {
  kind: MissionKind;
  /** 重さの段（1〜5） */
  tier: number;
  /** クリアしたときに合計点に掛ける倍率 */
  times: number;
  /** 回数のお題の回数、点数のお題の点数（役のお題では 1） */
  need: number;
  /** 役のお題の役の名前（役満の段は YAKUMAN_MARK）。ほかの種類では null */
  yaku: string | null;
}

export const MISSION_KINDS: readonly MissionKind[] = ['wins', 'points', 'yaku'];
export const MAX_MISSION_TIER = 5;

/**
 * 段ごとの値（添字は段 − 1）。賢い AI の sim（くま・初段）で、段 1 から順に 9 割・7 割・5 割・3 割・2 割ほど
 * 果たせるように決めた（docs/SPEC.md §4.1）
 */
export const MISSION_WINS: readonly number[] = [2, 3, 4, 5, 6];
export const MISSION_POINTS: readonly number[] = [3000, 5000, 8000, 12000, 20000];
/**
 * 役のお題の段。その役か、それより上の段のどれかの役で和了れば果たしたことにする。
 * 門前・混一色・断么九は易しすぎる（上の段の役を数えなくても 7 割前後）ので、お題にしない
 */
export const MISSION_YAKU: readonly (readonly string[])[] = [
  ['清一色', 'プチ三色', 'プチ国士'],
  ['三対子', 'プチ小四喜', '役牌'],
  ['プチ四暗刻', 'プチ一通'],
  ['プチ小三元'],
  [YAKUMAN_MARK],
];

/** 役のお題を果たす役（その役と、それより上の段の役。役満は YAKUMAN_MARK） */
export function missionYakuSet(m: Mission): readonly string[] {
  if (m.kind !== 'yaku') return [];
  return [m.yaku!, ...MISSION_YAKU.slice(m.tier).flat()];
}

/** 候補の枠（倍率と、段位の縛りがないときの段）。雀聖は前の枠を除いて 2 つにする（progression.ts の runRulesFor） */
export const MISSION_SLOTS: readonly { times: number; tier: number }[] = [
  { times: 1, tier: 1 },
  { times: 1.5, tier: 2 },
  { times: 2, tier: 3 },
];

export function makeMission(kind: MissionKind, tier: number, times: number, yaku: string | null = null): Mission {
  const t = Math.max(1, Math.min(MAX_MISSION_TIER, tier));
  if (kind === 'wins') return { kind, tier: t, times, need: MISSION_WINS[t - 1], yaku: null };
  if (kind === 'points') return { kind, tier: t, times, need: MISSION_POINTS[t - 1], yaku: null };
  if (yaku === null || !MISSION_YAKU[t - 1].includes(yaku)) throw new Error(`invalid yaku for tier ${t}: ${yaku}`);
  return { kind, tier: t, times, need: 1, yaku };
}

/**
 * このランのお題を作る。枠（段位の上乗せを足して 5 までに抑えた段。runRulesFor）ごとに種類を決め、枠どうしで種類が重ならないようにする
 * （種類の並びを乱数で入れ替えて、枠に順に割り当てる）。役のお題は、その段の役から乱数で選ぶ。
 * excludedYaku はお題にしない役（保留枠のない雀士の三対子など。その段の役がすべて除かれることはない）
 */
export function rollMissions(
  rng: number,
  slots: readonly { times: number; tier: number }[],
  excludedYaku: readonly string[] = [],
): [number, Mission[]] {
  let r = rng;
  const kinds = MISSION_KINDS.slice();
  for (let i = kinds.length - 1; i > 0; i--) {
    let j: number;
    [r, j] = nextInt(r, i + 1);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const out: Mission[] = [];
  slots.forEach((slot, i) => {
    const kind = kinds[i % kinds.length];
    const { tier } = slot;
    let yaku: string | null = null;
    if (kind === 'yaku') {
      const list = MISSION_YAKU[tier - 1].filter((y) => !excludedYaku.includes(y));
      let pick: number;
      [r, pick] = nextInt(r, list.length);
      yaku = list[pick];
    }
    out.push(makeMission(kind, tier, slot.times, yaku));
  });
  return [r, out];
}

/** お題の進み具合を見るための、ランの記録 */
export interface MissionProgress {
  /** 和了の回数（連荘の和了も数える） */
  wins: number;
  /** 4 局の合計点（流局の聴牌料・罰符・リーチ棒を含む） */
  points: number;
  /** このランで和了った役の名前（役満なら YAKUMAN_MARK も入る） */
  yakuWon: readonly string[];
}

/** お題を果たしたか */
export function missionMet(m: Mission, p: MissionProgress): boolean {
  switch (m.kind) {
    case 'wins':
      return p.wins >= m.need;
    case 'points':
      return p.points >= m.need;
    case 'yaku':
      return missionYakuSet(m).some((y) => p.yakuWon.includes(y));
  }
}

/** 果たしたかを添えたお題（ランの成績に残す） */
export type MissionResult = Mission & { met: boolean };

/** お題ごとに果たしたかを添える */
export const missionResults = (missions: readonly Mission[], p: MissionProgress): MissionResult[] =>
  missions.map((m) => ({ ...m, met: missionMet(m, p) }));

/** 果たしたお題の倍率の合計（記録点に掛ける。1 つも果たしていなければ 0） */
export const metTimes = (results: readonly MissionResult[]): number =>
  results.reduce((a, r) => a + (r.met ? r.times : 0), 0);

/** お題の文言（画面・集計・感想で同じものを使う） */
export function missionLabel(m: Mission): string {
  switch (m.kind) {
    case 'wins':
      return `和了 ${m.need} 回`;
    case 'points':
      return `合計 ${m.need.toLocaleString('en-US')} 点以上`;
    case 'yaku':
      // 上の段の役でもよい（役満の段はいちばん上なので「以上」を付けない）
      return m.yaku === YAKUMAN_MARK ? '役満で和了る' : `${m.yaku}以上の役で和了る`;
  }
}

/** 倍率の文言（「×1.5」） */
export const timesLabel = (times: number): string => `×${times}`;

/** お題と倍率（「×1.5 和了 3 回」。画面・感想で同じものを使う） */
export const missionText = (m: Mission): string => `${timesLabel(m.times)} ${missionLabel(m)}`;

/**
 * 和了の役の名前（和了った役の一覧 yakuWon に入れるもの）。役満なら YAKUMAN_MARK も入れる。
 * 精算（run.ts）と AI の見積もり（ai.ts）で同じ規則にするため、ここだけで作る
 */
export const wonYakuNames = (ev: { yaku: readonly { name: string }[]; yakuman: number }): string[] => [
  ...ev.yaku.map((y) => y.name),
  ...(ev.yakuman ? [YAKUMAN_MARK] : []),
];

export const MISSION_KIND_NAMES: Record<MissionKind, string> = { wins: '回数', points: '点数', yaku: '役' };

/** 集計で使う、お題の種類と段（「回数・段2」）。役のお題は役を問わずに段でまとめる */
export const missionKey = (m: Mission): string => `${MISSION_KIND_NAMES[m.kind]}・段${m.tier}`;
