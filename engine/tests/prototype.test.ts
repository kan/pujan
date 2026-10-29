/**
 * プロトタイプとの突き合わせ（docs/SPEC.md §6 フェーズ 1）。
 *
 * 乱数で作った手と局の状況を、プロトタイプの判定（evalHand・bestWin・judge・finalize・waitsFor）と
 * エンジンの判定の両方に通し、役・翻・点数・使った牌が一致するかを確かめる。
 * 手は役が出やすいように、牌の種類を絞った「テーマ」から引く。
 */
import { describe, expect, it } from 'vitest';
import { evaluateFive, evaluateSix, type Evaluation, type HandRules } from '../src/hand.js';
import {
  BOSSES,
  CHARMS,
  DEFAULT_BASE_RULES,
  SCROLL_YAKU,
  modifiersFor,
  type BossId,
  type CharmId,
  type EquipId,
} from '../src/items.js';
import { finalizeContext, judge, winContext, type KyokuState } from '../src/kyoku.js';
import { createRng, nextFloat, nextInt } from '../src/rng.js';
import { finalizeScore } from '../src/score.js';
import { EAST, GREEN, HAKU, KIND_COUNT, NINES, ONES, RED_FIVES, doraOf, type Kind, type Tile } from '../src/tiles.js';
import { waits, type Win } from '../src/win.js';
import { loadPrototype, type ProtoState, type ProtoTile, type ProtoWin } from './prototype.js';

const proto = loadPrototype();

/* ---------- 乱数 ---------- */

class Rand {
  constructor(private s: number) {}
  int(n: number): number {
    let v: number;
    [this.s, v] = nextInt(this.s, n);
    return v;
  }
  chance(p: number): boolean {
    let v: number;
    [this.s, v] = nextFloat(this.s);
    return v < p;
  }
  pick<T>(a: readonly T[]): T {
    return a[this.int(a.length)];
  }
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const ALL = range(0, KIND_COUNT);
const HONORS = range(27, 7);

/** 役が出やすいように牌の種類を絞った候補 */
function theme(r: Rand): Kind[] {
  const suitBase = r.int(3) * 9;
  switch (r.int(8)) {
    case 0:
      return ALL;
    case 1:
      return range(suitBase, 9);
    case 2:
      return [...range(suitBase, 9), ...HONORS];
    case 3:
      return HONORS;
    case 4:
      return [...GREEN];
    case 5:
      return [...ONES, ...NINES, ...HONORS];
    case 6: {
      // 狭い窓（面子と対子ができやすい）
      const start = suitBase + r.int(5);
      return [...range(start, 4), r.pick(HONORS)];
    }
    default: {
      // 同じ数字の 3 色（プチ三色）
      const n = r.int(9);
      return [n, 9 + n, 18 + n, r.pick(ALL)];
    }
  }
}

/** 種類ごとの上限（count）を守って n 枚引く */
function drawKinds(r: Rand, pool: readonly Kind[], n: number, count: readonly number[], used: number[]): Kind[] {
  const out: Kind[] = [];
  for (let guard = 0; out.length < n && guard < 1000; guard++) {
    const k = r.chance(0.85) ? r.pick(pool) : r.pick(ALL);
    if (used[k] >= count[k]) continue;
    used[k]++;
    out.push(k);
  }
  if (out.length < n) throw new Error('could not draw tiles');
  return out;
}

/* ---------- 役の比較用の表記 ---------- */

/** エンジンの役を、プロトタイプと同じ [名前, 表示値] の並びにする */
function engineYaku(ev: Evaluation): [string, string][] {
  if (!ev.yaku.length) return [['役なし', '']];
  return ev.yaku.map((y) => [y.name, y.yakuman ? (y.yakuman === 2 ? 'ダブル役満' : '役満') : `${y.han}翻`]);
}

const engineFive = (kinds: Kind[], rules: HandRules) => {
  const ev = evaluateFive(kinds, rules);
  return ev && { yaku: engineYaku(ev), noYaku: ev.noYaku };
};
const protoFive = (w: ProtoWin | null) => w && { yaku: w.yaku, noYaku: !!w.noyaku };

/* ---------- 局の状況 ---------- */

interface Scenario {
  bakaze: Kind;
  seat: Kind;
  charms: CharmId[];
  equipment: EquipId[];
  boss: BossId | null;
  indicators: Kind[];
  count: number[];
  hand: Tile[];
  drawn: Tile[];
  hold: (Tile | null)[];
  turn: number;
  discards: number;
  riichiTurn: number | null;
  dealer: boolean;
  honba: number;
  yakuLevels: Record<string, number>;
}

/** 判定に効くお守り（効かないものは混ぜても同じなので、組み合わせの数を絞るために外す） */
const JUDGE_CHARMS: CharmId[] = [
  'hayazashi',
  'yasude',
  'damaten',
  'ippatsuya',
  'bakuchi',
  'oyaji',
  'isuwari',
  'akaito',
  'iromegane',
  'tobiishi',
  'kazamidori',
  'hakushi',
  'nolimit',
];

function scenario(r: Rand, opts: { jokers: boolean }): Scenario {
  const charms = JUDGE_CHARMS.filter(() => r.chance(0.15)).filter((c) => opts.jokers || c !== 'hakushi');
  const equipment: EquipId[] = [];
  if (r.chance(0.3)) equipment.push('dora2');
  if (r.chance(0.2)) equipment.push('turns');
  if (opts.jokers && r.chance(0.7)) {
    equipment.push('joker');
    if (r.chance(0.5)) equipment.push('jokerplus');
  }
  const boss = r.chance(0.5) ? null : r.pick(BOSSES).id;
  const mods = modifiersFor(DEFAULT_BASE_RULES, { charms, equipment }, boss);

  // 牌の改造（写し・抜き取り）で枚数が変わった山
  const count = Array<number>(KIND_COUNT).fill(4);
  for (let i = r.int(3); i > 0; i--) count[r.int(KIND_COUNT)] = r.chance(0.5) ? 5 : 0;

  const used = Array<number>(KIND_COUNT).fill(0);
  const indicators = drawKinds(r, ALL, mods.doraIndicators, count, used);
  const doraKinds = indicators.map(doraOf);
  const isJoker = (k: Kind) => (mods.doraMode !== 'normal' && doraKinds.includes(k)) || (mods.hakuJoker && k === HAKU);

  const holdSlots = Math.max(mods.holdSlots, 0);
  const holdFilled = holdSlots ? r.int(holdSlots + 1) : 0;
  const drawnCount = r.chance(0.1) ? 2 : 1;
  const total = 4 + drawnCount + holdFilled;
  const pool = theme(r);
  let kinds = drawKinds(r, pool, total, count, used);
  // 万能牌が多すぎると試す組み合わせが爆発するので 2 枚までにする（3 枚以上は別のテストで見る）
  if (kinds.filter(isJoker).length > 2) kinds = kinds.filter((k, i, a) => !isJoker(k) || a.slice(0, i).filter(isJoker).length < 2);
  while (kinds.length < total) {
    const k = r.pick(ALL);
    if (isJoker(k) || used[k] >= count[k]) continue;
    used[k]++;
    kinds.push(k);
  }

  const tiles: Tile[] = kinds.map((kind, id) => ({ id, kind, red: RED_FIVES.includes(kind) && r.chance(0.5) }));
  const hand = tiles.slice(0, 4);
  const drawn = tiles.slice(4, 4 + drawnCount);
  const held = tiles.slice(4 + drawnCount);
  const hold: (Tile | null)[] = Array(holdSlots).fill(null);
  held.forEach((t, i) => (hold[i] = t));

  const turn = 1 + r.int(mods.turns);
  const riichiTurn = turn > 1 && r.chance(0.3) ? 1 + r.int(turn - 1) : null;
  const yakuLevels: Record<string, number> = {};
  for (const y of SCROLL_YAKU) if (r.chance(0.1)) yakuLevels[y] = 1 + r.int(2);

  return {
    bakaze: EAST + r.int(4),
    seat: EAST + r.int(4),
    charms,
    equipment,
    boss,
    indicators,
    count,
    hand,
    drawn,
    hold,
    turn,
    discards: turn === 2 && r.chance(0.5) ? 0 : turn - 1,
    riichiTurn,
    dealer: r.chance(0.3),
    honba: r.chance(0.3) ? 1 + r.int(3) : 0,
    yakuLevels,
  };
}

function engineState(sc: Scenario): KyokuState {
  const mods = modifiersFor(DEFAULT_BASE_RULES, { charms: sc.charms, equipment: sc.equipment }, sc.boss);
  const doraKinds = sc.indicators.map(doraOf);
  return {
    rng: 1,
    wall: [],
    hand: sc.hand,
    drawn: sc.drawn,
    hold: sc.hold,
    river: [],
    indicators: sc.indicators.map((kind, i) => ({ id: 100 + i, kind })),
    doraKinds,
    jokerKinds: mods.doraMode === 'normal' ? [] : doraKinds,
    turn: sc.turn,
    discards: sc.discards,
    redealt: false,
    riichi: sc.riichiTurn === null ? null : { turn: sc.riichiTurn, stick: mods.riichiCost },
    peek: false,
    extraTurns: 0,
    removed: [],
    waits: [],
    win: null,
    result: null,
    setup: {
      mods,
      bakaze: sc.bakaze,
      seat: sc.seat,
      dealer: sc.dealer,
      honba: sc.honba,
      yakuLevels: sc.yakuLevels,
      copies: sc.count,
    },
  };
}

const protoTile = (t: Tile): ProtoTile => ({ k: t.kind, id: t.id, red: !!t.red, gold: !!t.gold });

function protoState(sc: Scenario): ProtoState {
  const mods = modifiersFor(DEFAULT_BASE_RULES, { charms: sc.charms, equipment: sc.equipment }, sc.boss);
  const doras = sc.indicators.map(doraOf);
  return {
    S: {
      jk: new Set(sc.equipment.includes('joker') ? doras : []),
      boss: sc.boss,
      doras,
      bakaze: sc.bakaze,
      seat: sc.seat,
      riichi: sc.riichiTurn !== null,
      riichiTurn: sc.riichiTurn ?? 0,
      turn: sc.turn,
      discards: sc.discards,
      T: mods.turns,
      hand: sc.hand.map(protoTile),
      drawn: sc.drawn.map(protoTile),
      hold: sc.hold.map((t) => t && protoTile(t)),
    },
    // プロトタイプは「今の局が親の局か」を G.kyoku === G.oya で見る
    G: { kyoku: sc.dealer ? 0 : 1, oya: 0, honba: sc.honba },
    R: { charms: sc.charms, equip: sc.equipment, lv: sc.yakuLevels, comp: { count: sc.count } },
  };
}

/** 判定の結果を比べやすい形にする */
const winShape = (w: Win | null) =>
  w && { pts: w.points, yaku: engineYaku(w.evaluation), ids: w.tileIds, kinds: w.kinds };
const protoWinShape = (w: ProtoWin | null) => w && { pts: w.pts, yaku: w.yaku, ids: w.ids, kinds: w.kinds };

function engineFinal(s: KyokuState, w: Win) {
  const score = finalizeScore(w.evaluation, finalizeContext(s));
  return { pts: score.points, lines: score.lines.map((l) => [l.label, l.value]) };
}

/* ---------- テスト ---------- */

describe('プロトタイプとの突き合わせ', () => {
  it('5 枚の役判定（evalHand）が一致する', () => {
    const r = new Rand(createRng(20261027));
    let wins = 0;
    for (let i = 0; i < 20000; i++) {
      const rules: HandRules = {
        bakaze: EAST + r.int(4),
        seat: EAST + r.int(4),
        sameColorManSou: r.chance(0.2),
        skipSequences: r.chance(0.2),
        allWindsYakuhai: r.chance(0.2),
      };
      const charms = [
        rules.sameColorManSou && 'iromegane',
        rules.skipSequences && 'tobiishi',
        rules.allWindsYakuhai && 'kazamidori',
      ].filter(Boolean) as string[];
      proto.set({
        S: { bakaze: rules.bakaze, seat: rules.seat } as ProtoState['S'],
        G: { kyoku: 0, oya: 0, honba: 0 },
        R: { charms, equip: [], lv: {}, comp: { count: Array(KIND_COUNT).fill(4) } },
      });
      const kinds = drawKinds(r, theme(r), 5, Array(KIND_COUNT).fill(4), Array(KIND_COUNT).fill(0));
      const got = engineFive(kinds, rules);
      expect(got, `手 ${kinds.join(',')}`).toEqual(protoFive(proto.evalHand(kinds)));
      if (got) wins++;
    }
    // 和了形が十分に含まれていること（テーマの作り方が壊れていないか）
    expect(wins).toBeGreaterThan(1000);
  });

  it('6 枚の三対子（evalSix）が一致する', () => {
    const r = new Rand(createRng(6));
    for (let i = 0; i < 5000; i++) {
      const iromegane = r.chance(0.3);
      proto.set({
        S: { bakaze: EAST, seat: EAST } as ProtoState['S'],
        G: { kyoku: 0, oya: 0, honba: 0 },
        R: { charms: iromegane ? ['iromegane'] : [], equip: [], lv: {}, comp: { count: Array(KIND_COUNT).fill(4) } },
      });
      const pool = theme(r);
      const pairs = [r.pick(pool), r.pick(pool), r.chance(0.8) ? r.pick(pool) : r.pick(ALL)];
      const kinds = [...pairs, ...pairs];
      if (r.chance(0.2)) kinds[5] = r.pick(ALL);
      const ev = evaluateSix(kinds, { bakaze: EAST, seat: EAST, sameColorManSou: iromegane });
      expect(ev && engineYaku(ev), `手 ${kinds.join(',')}`).toEqual(proto.evalSix(kinds)?.yaku ?? null);
    }
  });

  it('局の中の和了判定（judge）と点数（finalize）が一致する', () => {
    const r = new Rand(createRng(42));
    let wins = 0;
    for (let i = 0; i < 1500; i++) {
      const sc = scenario(r, { jokers: i % 3 === 0 });
      const s = engineState(sc);
      proto.set(protoState(sc));
      const w = judge(s);
      const pw = proto.judge();
      const where = `${i}: ${JSON.stringify(sc)}`;
      expect(winShape(w), where).toEqual(protoWinShape(pw));
      if (!w || !pw) continue;
      wins++;
      const final = proto.finalize(pw);
      expect(engineFinal(s, w), where).toEqual({ pts: final.pts, lines: final.yaku });
    }
    expect(wins).toBeGreaterThan(300);
  });

  it('待ち（waitsFor）が一致する', () => {
    const r = new Rand(createRng(7));
    for (let i = 0; i < 300; i++) {
      const sc = scenario(r, { jokers: i % 4 === 0 });
      const s = engineState(sc);
      proto.set(protoState(sc));
      // 打牌したあとの形（手牌 4 枚と保留牌）で待ちを求める
      const tiles = [...sc.hand, ...(sc.hold.filter(Boolean) as Tile[])];
      expect(waits(tiles, winContext(s, false)), `${i}: ${JSON.stringify(sc)}`).toEqual(proto.waitsFor(tiles.map(protoTile)));
    }
  });

  it('万能牌が 3 枚以上の和了（候補を絞る経路）が一致する', { timeout: 60000 }, () => {
    const r = new Rand(createRng(3));
    for (let i = 0; i < 20; i++) {
      const sc = scenario(r, { jokers: false });
      sc.equipment = ['joker'];
      // ドラが万能牌。手の 3 枚をドラにする
      const dora = doraOf(sc.indicators[0]);
      if (sc.count[dora] < 3) sc.count[dora] = 4;
      sc.hold = sc.hold.map(() => null);
      sc.drawn = sc.drawn.slice(0, 1);
      sc.hand = sc.hand.map((t, j) => (j < 3 ? { ...t, kind: dora, red: false } : t));
      const s = engineState(sc);
      proto.set(protoState(sc));
      expect(winShape(judge(s)), `${i}: ${JSON.stringify(sc)}`).toEqual(protoWinShape(proto.judge()));
    }
  });
});

// 判定に効かないお守りを JUDGE_CHARMS から外したことの確認（増やしたときに見落とさないため）
it('JUDGE_CHARMS は判定に効かないお守りだけを外している', () => {
  const left = CHARMS.map((c) => c.id).filter((id) => !JUDGE_CHARMS.includes(id));
  expect(left.sort()).toEqual(['chokin', 'ura2']);
});
