/**
 * バランス調整用のシミュレーション。仕様は docs/SPEC.md §6 フェーズ 1。
 *
 * - dealTable: 配牌 5 枚（山から 5 枚）でそのまま目標の形になる確率を、正確に数える
 * - simulateTarget: 目標の形を狙って打つ AI で、1 局のうちに和了れる割合を測る
 * - simulateRuns: 同じ AI でランを遊ばせ、どの場まで進めたかを数える（アイテムを持たせて比べる）
 *
 * CLI（scripts/sim.mjs）とテストから使う。frontend からは使わないので index.ts からは出さない。
 */
import { apply, createGame, isFinished, type GameAction } from './game.js';
import { evaluateFive, type HandRules } from './hand.js';
import {
  DEFAULT_BASE_RULES,
  MAX_CHARMS,
  modifiersFor,
  type BaseRules,
  type CharmId,
  type EquipId,
  type ModId,
} from './items.js';
import {
  canRiichi,
  defaultComposition,
  remainingOf,
  startKyoku,
  step,
  turnLimit,
  visibleNext,
  type KyokuMove,
  type KyokuState,
  type Zone,
} from './kyoku.js';
import type { RunStart } from './progression.js';
import { createRng, mix32, nextInt } from './rng.js';
import { WAVE_COUNT, canGacha, type RunState } from './run.js';
import { DRAGONS, EAST, KIND_COUNT, NINES, ONES, SOUTH, WINDS, suit, type Kind } from './tiles.js';

/* ---------- 目標の形 ---------- */

/**
 * 目標の形。仕様の「難しさの目安」（§3.3）と同じく、上位の役（役満など）に吸収される手も形として数える。
 * 引数は昇順に並んだ 5 枚の種類。
 */
export type TargetName = '基本和了' | 'プチ国士' | '清一色' | 'プチ小三元' | 'プチ大三元' | '和了形';

function isMeld(a: Kind, b: Kind, c: Kind): boolean {
  if (a === b && b === c) return true;
  return c < 27 && suit(a) === suit(c) && b === a + 1 && c === a + 2;
}

/** 対子＋面子（順子・刻子）に分けられる */
function pairAndMeld(k: readonly Kind[]): boolean {
  for (let i = 0; i < 4; i++) {
    if (k[i] !== k[i + 1] || (i > 0 && k[i - 1] === k[i])) continue;
    const rest = k.filter((_, j) => j !== i && j !== i + 1);
    if (isMeld(rest[0], rest[1], rest[2])) return true;
  }
  return false;
}

const countOf = (k: readonly Kind[], x: Kind) => k.filter((y) => y === x).length;

/** 「和了形」の判定に使う、言い張りのない役判定のルール */
const PLAIN_RULES: HandRules = { bakaze: EAST, seat: SOUTH };

const TARGET_TESTS: Record<TargetName, (k: readonly Kind[]) => boolean> = {
  基本和了: pairAndMeld,
  プチ国士: (k) => {
    const d = [...new Set(k)];
    return (
      d.length === 4 &&
      d.every((x) => countOf(k, x) <= 2) &&
      [DRAGONS, WINDS, ONES, NINES].every((cat) => d.filter((x) => cat.includes(x)).length === 1)
    );
  },
  清一色: (k) => k[4] < 27 && suit(k[0]) === suit(k[4]) && pairAndMeld(k),
  プチ小三元: (k) => {
    if (!DRAGONS.every((d) => k.includes(d))) return false;
    const rest = k.slice();
    for (const d of DRAGONS) rest.splice(rest.indexOf(d), 1);
    return rest[0] === rest[1];
  },
  プチ大三元: (k) => DRAGONS.some((d) => countOf(k, d) === 3 && DRAGONS.every((e) => e === d || countOf(k, e) === 1)),
  和了形: (k) => evaluateFive(k, PLAIN_RULES) !== null,
};

export const TARGET_NAMES = Object.keys(TARGET_TESTS) as TargetName[];

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** 種類ごとの枚数（各 4 枚まで）の 5 枚の組をすべて訪ねる。weight は 136 枚から引く通り数 */
function forEachFive(visit: (kinds: readonly Kind[], weight: number) => void): void {
  const kinds: Kind[] = [];
  const rec = (k: number, left: number, weight: number) => {
    if (!left) {
      visit(kinds, weight);
      return;
    }
    if (k >= KIND_COUNT) return;
    for (let c = 0; c <= Math.min(left, 4); c++) {
      for (let i = 0; i < c; i++) kinds.push(k);
      rec(k + 1, left - c, weight * binom(4, c));
      for (let i = 0; i < c; i++) kinds.pop();
    }
  };
  rec(0, 5, 1);
}

export interface DealRow {
  name: TargetName;
  /** 確率 */
  p: number;
}

/** 配牌 5 枚（136 枚の山から 5 枚）でそのまま目標の形になる確率 */
export function dealTable(names: readonly TargetName[] = TARGET_NAMES): DealRow[] {
  const total = binom(136, 5);
  const sums = names.map(() => 0);
  forEachFive((kinds, w) => names.forEach((n, i) => TARGET_TESTS[n](kinds) && (sums[i] += w)));
  return names.map((name, i) => ({ name, p: sums[i] / total }));
}

/* ---------- 目標を狙う AI ---------- */

/** 目標の形になる 5 枚の組（種類と枚数） */
interface Template {
  kinds: Kind[];
  counts: number[];
}

const templateCache = new Map<TargetName, Template[]>();

function templatesOf(name: TargetName): Template[] {
  const hit = templateCache.get(name);
  if (hit) return hit;
  const out: Template[] = [];
  forEachFive((kinds) => {
    if (!TARGET_TESTS[name](kinds)) return;
    const d = [...new Set(kinds)];
    out.push({ kinds: d, counts: d.map((x) => countOf(kinds, x)) });
  });
  templateCache.set(name, out);
  return out;
}

interface Outlook {
  /** 目標の形がもうできている */
  complete: boolean;
  /** 残りのツモで形ができる見込み（大きいほど良い。確率の目安） */
  score: number;
  /** いちばん近い形まであと何枚か */
  minNeed: number;
}

/** 見込みの計算に使う、山の見え方 */
interface WallView {
  /** 見えていない牌（種類ごと） */
  avail: readonly number[];
  /** ネクストで見えている、これから来る牌（種類ごと） */
  known: readonly number[];
  /** 残りのツモの回数（ネクストの分を含む） */
  draws: number;
  /** 見えていない牌を 1 枚引ける確率の目安（ネクストの分を除いた残りのツモ ÷ 見えていない牌の数） */
  q: number;
}

function wallView(avail: readonly number[], known: readonly number[], draws: number): WallView {
  const unseen = avail.reduce((a, c) => a + c, 0);
  const knownTotal = known.reduce((a, c) => a + c, 0);
  const q = unseen ? Math.min(1, Math.max(0, draws - knownTotal) / unseen) : 0;
  return { avail, known, draws, q };
}

/**
 * 手元の牌（have: 種類ごとの枚数）から目標の形ができる見込み。
 * 足りない牌のうち、ネクストで見えている牌は必ず来るものとし、残りを見えていない牌から引ける確率をおおまかに足し合わせる。
 */
function outlook(templates: readonly Template[], have: readonly number[], view: WallView): Outlook {
  const { avail, known, draws, q } = view;
  let score = 0;
  let minNeed = Infinity;
  for (const t of templates) {
    let need = 0;
    let unknownNeed = 0;
    let w = 1;
    for (let j = 0; j < t.kinds.length; j++) {
      const k = t.kinds[j];
      const d = t.counts[j] - have[k];
      if (d <= 0) continue;
      const fromUnknown = Math.max(0, d - known[k]);
      if (avail[k] < fromUnknown) {
        w = 0;
        break;
      }
      w *= binom(avail[k], fromUnknown);
      need += d;
      unknownNeed += fromUnknown;
    }
    if (!w) continue;
    if (need === 0) return { complete: true, score: Infinity, minNeed: 0 };
    if (need < minNeed) minNeed = need;
    if (need <= draws) score += w * q ** unknownNeed;
  }
  return { complete: false, score, minNeed };
}

interface Located {
  zone: Zone;
  index: number;
  kind: Kind;
}

function located(s: KyokuState): Located[] {
  const out: Located[] = [];
  s.hand.forEach((t, index) => out.push({ zone: 'hand', index, kind: t.kind }));
  s.drawn.forEach((t, index) => out.push({ zone: 'drawn', index, kind: t.kind }));
  s.hold.forEach((t, index) => t && out.push({ zone: 'hold', index, kind: t.kind }));
  return out;
}

export interface BotOptions {
  target: TargetName;
  /** 聴牌したらリーチする */
  riichi?: boolean;
}

/**
 * 1 手を選ぶ。目標の形ができていれば和了り、そうでなければ形の見込みが最も高くなるように捨てるか保留する。
 * 保留は手元の牌を減らさないので、空いた枠があれば見込みは下がらない。
 */
export function botAction(s: KyokuState, opts: BotOptions): KyokuMove {
  const templates = templatesOf(opts.target);
  const tiles = located(s);
  const have = Array<number>(KIND_COUNT).fill(0);
  for (const t of tiles) have[t.kind]++;
  const draws = turnLimit(s) - s.turn;
  const next = visibleNext(s).slice(0, draws);
  const known = Array<number>(KIND_COUNT).fill(0);
  for (const t of next) known[t.kind]++;
  // ネクストで見えている牌は「見えていない牌」から外す
  const avail = known.map((n, k) => Math.max(0, remainingOf(s, k) - n));
  const view = wallView(avail, known, draws);

  if (s.win && (opts.target === '和了形' || outlook(templates, have, view).complete)) return { type: 'tsumo' };
  if (s.riichi) return { type: 'discard', zone: 'drawn', index: 0 };

  let best = { action: null as KyokuMove | null, score: -1, minNeed: Infinity };
  const consider = (action: KyokuMove, kept: number[]) => {
    const o = outlook(templates, kept, view);
    if (o.score > best.score) best = { action, score: o.score, minNeed: o.minNeed };
  };
  const emptySlot = s.hold.indexOf(null);
  if (emptySlot >= 0) consider({ type: 'hold', zone: 'drawn', index: 0, slot: emptySlot }, have);
  const tried = new Set<Kind>();
  for (const t of tiles) {
    // 同じ種類の牌は、どれを捨てても手元の形は同じ
    if (tried.has(t.kind)) continue;
    tried.add(t.kind);
    const kept = have.slice();
    kept[t.kind]--;
    consider({ type: 'discard', zone: t.zone, index: t.index }, kept);
  }
  // 捨てる候補は必ずあるので、action は埋まっている
  const a = best.action!;
  if (opts.riichi && a.type === 'discard' && best.minNeed === 1 && draws > 0 && canRiichi(s, a.zone, a.index)) {
    return { type: 'riichi', zone: a.zone, index: a.index };
  }
  return a;
}

/* ---------- 1 局の和了率 ---------- */

export interface TargetSimOptions {
  target: TargetName;
  games: number;
  seed: number;
  /** 基本ルールの上書き（保留枠・ネクスト・巡数など） */
  rules?: Partial<BaseRules>;
  /** 1 巡目に消耗品の染め粉を使い、この色（0 萬子・1 筒子・2 索子・3 字牌）を残す */
  dye?: number;
}

export interface TargetSimResult {
  games: number;
  wins: number;
  rate: number;
  /** 和了った巡の平均 */
  meanTurn: number;
}

export function simulateTarget(opts: TargetSimOptions): TargetSimResult {
  const base = { ...DEFAULT_BASE_RULES, ...opts.rules };
  const mods = modifiersFor(base, { charms: [], equipment: [] }, null);
  let rng = createRng(mix32(opts.seed));
  let wins = 0;
  let turns = 0;
  for (let g = 0; g < opts.games; g++) {
    let raw: number;
    [rng, raw] = nextInt(rng, 0x7fffffff);
    let s = startKyoku({
      rng: createRng(mix32(raw)),
      composition: defaultComposition(base.redFives),
      mods,
      bakaze: EAST,
      seat: SOUTH,
      dealer: false,
      honba: 0,
      yakuLevels: {},
    });
    if (opts.dye !== undefined && !s.result) s = step(s, { type: 'consumable', id: 'some', color: opts.dye });
    while (!s.result) s = step(s, botAction(s, { target: opts.target }));
    if (s.result.type === 'win') {
      wins++;
      turns += s.turn;
    }
  }
  return { games: opts.games, wins, rate: wins / opts.games, meanTurn: wins ? turns / wins : 0 };
}

/* ---------- ラン ---------- */

export interface RunSimOptions {
  runs: number;
  seed: number;
  /** 最初から持たせるお守りと設備 */
  charms?: CharmId[];
  equipment?: EquipId[];
  /** 最初から当てておく牌の改造 */
  mods?: { id: ModId; kind: Kind }[];
  /** 聴牌したらリーチする（既定は true） */
  riichi?: boolean;
  /** 始めの条件（雀士・段位・解禁済みの役。既定は標準の雀士・初段・解禁なし） */
  start?: RunStart;
  /** ショップで買えるお守りと設備を買う（既定は何も買わない） */
  buy?: boolean;
  /** ショップで福引きを回せるなら回す（買い物より先に） */
  gacha?: boolean;
}

export interface RunSimResult {
  runs: number;
  /** reached[i]: i 番目の場（0: 東〜3: 北）まで進んだランの数。reached[4] は全場クリア */
  reached: number[];
  /** 突破した場の数の平均（0〜4） */
  meanCleared: number;
  /** 局ごとの和了率 */
  winRate: number;
}

/**
 * ショップで買う品の番号（買わないなら -1）。祝儀で買える、まだ売れていないお守りか設備を、並びの順に 1 つ。
 * 消耗品・牌の改造・役の巻物は使い方に判断が要るので買わない（遊ぶ人より弱い目安になる）
 */
function shopPick(run: RunState): number {
  return (run.shop ?? []).findIndex(
    (o) =>
      !o.sold &&
      o.price <= run.money &&
      ((o.kind === 'charm' && run.charms.length < MAX_CHARMS) || o.kind === 'equip'),
  );
}

/**
 * AI にランを遊ばせる。既定ではショップで何も買わず、持たせたアイテムの効き目だけを見る（buy で買わせる）。
 * 和了れる手ができたらすぐ和了り、親の和了では必ず連荘する。
 */
export function simulateRuns(opts: RunSimOptions): RunSimResult {
  const reached = Array<number>(WAVE_COUNT + 1).fill(0);
  let rng = createRng(mix32(opts.seed));
  let kyoku = 0;
  let won = 0;
  for (let i = 0; i < opts.runs; i++) {
    let seed: number;
    [rng, seed] = nextInt(rng, 0x7fffffff);
    // 画面やサーバーの再生と同じ apply() で進める
    let g = createGame(seed, {
      start: opts.start,
      loadout: { charms: opts.charms ?? [], equipment: opts.equipment ?? [] },
      mods: opts.mods,
    });
    for (let actions = 0; !isFinished(g); actions++) {
      // 親の和了が続くなどで終わらないランを打ち切る（1 ランはふつう数百手）
      if (actions > 100000) throw new Error(`run ${i} did not finish`);
      if (!g.kyoku) {
        const pick = opts.buy ? shopPick(g.run) : -1;
        const shop: GameAction =
          opts.gacha && canGacha(g.run) ? { type: 'gacha' } : pick >= 0 ? { type: 'buy', index: pick } : { type: 'leave' };
        g = apply(g, shop);
      } else if (!g.kyoku.result) {
        g = apply(g, botAction(g.kyoku, { target: '和了形', riichi: opts.riichi ?? true }));
      } else {
        kyoku++;
        if (g.kyoku.result.type === 'win') won++;
        g = apply(g, { type: 'settle', renchan: true });
      }
    }
    reached[g.run.phase === 'cleared' ? WAVE_COUNT : g.run.wave]++;
  }
  const meanCleared = reached.reduce((a, n, w) => a + n * w, 0) / opts.runs;
  return { runs: opts.runs, reached, meanCleared, winRate: kyoku ? won / kyoku : 0 };
}
