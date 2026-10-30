/**
 * 賢く打つ AI（GitHub issue #13）。シミュレーションと、対戦の CPU（docs/SPEC.md §3.7）に使う。
 *
 * sim.ts の botAction（目標の形に近づけるだけ）と違い、点数の期待値で打つ。
 *
 * - 局: 和了形（5 枚の組と、三対子の 6 枚の組）ごとに「残りのツモで揃う見込み × 揃ったときの点数」を足し合わせ、
 *   打牌・保留・和了るか・リーチ・消耗品・延長を、その見積もりの大きいほうに決める
 * - 点数は、場の目標点までの残りで重みを付けた「効用」で比べる（足りない分までは点数どおり、超えた分は小さく数える。
 *   場の最後の局では、目標に届くかどうかを大きく数える）
 * - ショップ: アイテムの価値の目安（祝儀に換算）で、買う・売る・品替え・福引き・牌の改造の対象を決める
 * - 精算: 親の和了は連荘する。ただし場の最後の局で、流局の罰符で目標点を割る恐れがあるときはやめる
 *
 * 見てよいのは、遊ぶ人に見えるもの（手元の牌・河・ドラ表示・ネクスト・山の残りの数）だけ。山の並びは読まない。
 * 乱数を使わないので、同じ状態からは必ず同じ手を選ぶ（サーバーの再生や画面の CPU からも使える）。
 * 対戦用の判断（相手の河や保留枠を読む、ロンを避ける）はまだ入れていない（フェーズ 5 で足す）。
 */
import type { GameAction, GameState } from './game.js';
import { addHan, evaluateFive, evaluateSix, yakuEntry, type HandRules } from './hand.js';
import {
  EXTEND_PRICE,
  EXTEND_TURNS,
  GACHA,
  MAX_CHARMS,
  REROLL_PRICE,
  SELL_PRICES,
  SOME_COLORS,
  type CharmId,
  type ConsumableId,
  type EquipId,
  type ModId,
} from './items.js';
import {
  allTiles,
  canExtend,
  canRedeal,
  canRiichi,
  canUseConsumable,
  finalizeContext,
  isJoker,
  notenPenalty,
  remainingOf,
  turnLimit,
  visibleNext,
  winContext,
  type Composition,
  type KyokuMove,
  type KyokuState,
  type Zone,
} from './kyoku.js';
import { mix32, nextInt } from './rng.js';
import {
  KYOKU_PER_WAVE,
  WAVE_COUNT,
  buyBlocker,
  canGacha,
  canModify,
  isDealerKyoku,
  orasuNeed,
  ownedCharms,
  type Offer,
  type RunState,
} from './run.js';
import { YAKUMAN_POINTS, finalizeScore, pointsOfHan } from './score.js';
import { CHUN, EAST, HAKU, KIND_COUNT, NORTH, SOUTH, WEST, num, suit, type Kind, type Tile } from './tiles.js';
import { bestWin, waits } from './win.js';

/* ---------- 和了形の一覧 ---------- */

/**
 * 和了形の一覧。種類と枚数を平たい配列に詰める（局の 1 手ごとに全部なめるので、速さのために配列で持つ）。
 * 5 枚の組は約 4,000 通り、三対子の 6 枚の組は 5,984 通り
 */
interface Shapes {
  count: number;
  /** i 番目の形の種類は kinds[offset[i] .. offset[i] + length[i]] */
  offset: Int32Array;
  length: Int8Array;
  kinds: Int8Array;
  counts: Int8Array;
  /** 牌の枚数（5 か 6） */
  size: Int8Array;
}

/** 形を決める言い張り（色眼鏡・飛び石・巡り目）。場風・自風や風見鶏は翻だけを変える */
const shapeKey = (r: HandRules) => `${+!!r.sameColorManSou}${+!!r.skipSequences}${+!!r.wrapSequences}`;
const shapeCache = new Map<string, Shapes>();

function shapesFor(rules: HandRules): Shapes {
  const key = shapeKey(rules);
  const hit = shapeCache.get(key);
  if (hit) return hit;
  const list: { kinds: number[]; counts: number[]; size: number }[] = [];
  const push = (multiset: readonly Kind[]) => {
    const kinds = [...new Set(multiset)];
    list.push({ kinds, counts: kinds.map((k) => multiset.filter((x) => x === k).length), size: multiset.length });
  };
  const plain: HandRules = { ...rules, bakaze: EAST, seat: SOUTH };
  const acc: Kind[] = [];
  const rec = (k: number, left: number) => {
    if (!left) {
      if (evaluateFive(acc, plain)) push(acc);
      return;
    }
    if (k >= KIND_COUNT) return;
    for (let c = 0; c <= Math.min(left, 4); c++) {
      for (let i = 0; i < c; i++) acc.push(k);
      rec(k + 1, left - c);
      for (let i = 0; i < c; i++) acc.pop();
    }
  };
  rec(0, 5);
  for (let a = 0; a < KIND_COUNT; a++) {
    for (let b = a + 1; b < KIND_COUNT; b++) for (let c = b + 1; c < KIND_COUNT; c++) push([a, a, b, b, c, c]);
  }
  const total = list.reduce((n, s) => n + s.kinds.length, 0);
  const shapes: Shapes = {
    count: list.length,
    offset: new Int32Array(list.length),
    length: new Int8Array(list.length),
    kinds: new Int8Array(total),
    counts: new Int8Array(total),
    size: new Int8Array(list.length),
  };
  let o = 0;
  list.forEach((s, i) => {
    shapes.offset[i] = o;
    shapes.length[i] = s.kinds.length;
    shapes.size[i] = s.size;
    s.kinds.forEach((k, j) => {
      shapes.kinds[o + j] = k;
      shapes.counts[o + j] = s.counts[j];
    });
    o += s.kinds.length;
  });
  shapeCache.set(key, shapes);
  return shapes;
}

/** 形ごとの役（場風・自風と言い張りで決まる。同じルールの局で使い回す） */
interface Judged {
  shapes: Shapes;
  /** 役満の倍数（0 は通常の役。和了形でなければ -1） */
  yakuman: Int8Array;
  han: Int8Array;
  noYaku: Uint8Array;
  yaku: string[][];
}

const judgedCache = new Map<string, Judged>();

function judgedFor(rules: HandRules): Judged {
  const key = `${shapeKey(rules)}${+!!rules.allWindsYakuhai}:${rules.bakaze}:${rules.seat}`;
  const hit = judgedCache.get(key);
  if (hit) return hit;
  const shapes = shapesFor(rules);
  const n = shapes.count;
  const j: Judged = { shapes, yakuman: new Int8Array(n), han: new Int8Array(n), noYaku: new Uint8Array(n), yaku: [] };
  const kinds: Kind[] = [];
  for (let i = 0; i < n; i++) {
    kinds.length = 0;
    const o = shapes.offset[i];
    for (let x = 0; x < shapes.length[i]; x++) for (let c = 0; c < shapes.counts[o + x]; c++) kinds.push(shapes.kinds[o + x]);
    const ev = shapes.size[i] === 5 ? evaluateFive(kinds, rules) : evaluateSix(kinds, rules);
    j.yakuman[i] = ev ? ev.yakuman : -1;
    j.han[i] = ev ? ev.han : 0;
    j.noYaku[i] = ev?.noYaku ? 1 : 0;
    j.yaku.push(ev ? ev.yaku.map((y) => y.name) : []);
  }
  judgedCache.set(key, j);
  return j;
}

/** 1 局のあいだ変わらない、形ごとの役と翻（ドラと役の巻物で変わるので、局ごとに作る） */
interface Prepared {
  shapes: Shapes;
  /** 役満の倍数（0 は通常の役） */
  yakuman: Int8Array;
  /** 役の翻＋ドラの翻（化け猫のときドラは数えない） */
  han: Int8Array;
  noYaku: Uint8Array;
  /** 役の巻物の倍率 */
  level: Float64Array;
  /** 和了形でない形と、1翻縛りで和了れない形 */
  banned: Uint8Array;
}

const preparedCache = new WeakMap<object, Prepared>();

function prepare(s: KyokuState): Prepared {
  const hit = preparedCache.get(s.setup);
  if (hit) return hit;
  const j = judgedFor(winContext(s, false).rules);
  const { shapes } = j;
  const m = s.setup.mods;
  const n = shapes.count;
  const levels = Object.keys(s.setup.yakuLevels).length > 0;
  const dora = new Int8Array(KIND_COUNT);
  if (m.doraMode === 'normal' && !m.noBonus) for (const d of s.doraKinds) dora[d]++;
  const p: Prepared = {
    shapes,
    yakuman: j.yakuman,
    han: new Int8Array(n),
    noYaku: j.noYaku,
    level: new Float64Array(n).fill(1),
    banned: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    if (j.yakuman[i] < 0 || (m.shibari && j.noYaku[i])) {
      p.banned[i] = 1;
      continue;
    }
    let h = j.han[i];
    const o = shapes.offset[i];
    for (let x = 0; x < shapes.length[i]; x++) h += dora[shapes.kinds[o + x]] * shapes.counts[o + x];
    p.han[i] = h;
    if (levels) for (const y of j.yaku[i]) p.level[i] *= 1.5 ** (s.setup.yakuLevels[y] ?? 0);
  }
  preparedCache.set(s.setup, p);
  return p;
}

/* ---------- 効用（場の目標点で重みを付けた点数） ---------- */

/** ランの状況。局だけを遊ばせるとき（対戦の CPU など）は渡さず、点数そのものを比べる */
export interface AiSituation {
  /** 場の目標点までの残り（0 以下なら届いている） */
  need: number;
  /** 場の目標点 */
  target: number;
  /** この局が場の最後の局（4 局目） */
  lastKyoku: boolean;
  /** 突破にまだ要る、オーラスの和了の点数（段位の縛り。条件がないか、もう満たしていれば null） */
  orasuMin: number | null;
  /** 祝儀 1 の点数への換算（延長に祝儀を払うかの判断に使う） */
  moneyValue: number;
  money: number;
  /** 山の構成（赤牌・金牌の残りの見込みに使う） */
  composition?: Composition;
}

/** 目標点を超えた分の重み（祝儀の目標超過のボーナスとランキングの合計点に効くので、0 にはしない） */
const OVER_WEIGHT = 0.3;
/** 場の最後の局で目標に届いたときの重み（目標点の何倍に数えるか） */
const PASS_WEIGHT = 10;
/** 金牌 1 枚の点数への換算（祝儀 2 と福引き券） */
const GOLD_POINTS = 150;

/** 局の点数の増減 p の効用。win は和了（場の最後の局でも、親の和了なら連荘でまだ続けられる） */
function utility(p: number, sit: AiSituation | undefined, dealer: boolean, win: boolean): number {
  if (!sit) return p;
  if (sit.lastKyoku && !(win && dealer)) {
    const pass = p >= sit.need && (sit.orasuMin === null || (win && p >= sit.orasuMin));
    return (pass ? PASS_WEIGHT * sit.target : 0) + OVER_WEIGHT * p;
  }
  if (sit.need <= 0) return OVER_WEIGHT * p;
  return Math.min(p, sit.need) + OVER_WEIGHT * Math.max(0, p - sit.need);
}

/* ---------- 見積もり ---------- */

/** 見積もりに使う山の見え方 */
interface View {
  /** 残りのツモの回数 */
  draws: number;
  /** ネクストで見えている、これから来る牌（種類ごと） */
  known: Int8Array;
  knownTotal: number;
  /** 見えていない牌（種類ごと。万能牌の種類は 0 にして jokerAvail に数える） */
  avail: Int8Array;
  jokerAvail: number;
  /** 見えていない牌の数 */
  unseen: number;
  /** atLeast[a][n]: 見えていない牌のうち a 枚ある種類を、残りのツモで n 枚以上引ける確率 */
  atLeast: Float64Array[];
  /** 見えていない牌のうち赤牌・金牌の割合（種類ごと） */
  redFrac: Float64Array;
  goldFrac: Float64Array;
  /** ネクストで見えている赤牌・金牌（種類ごと） */
  knownRed: Int8Array;
  knownGold: Int8Array;
}

const MAX_A = 12;

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** 超幾何分布で、a 枚ある種類を m 回のツモで n 枚以上引く確率の表 */
function atLeastTable(unseen: number, m: number): Float64Array[] {
  const total = binom(unseen, m);
  const table: Float64Array[] = [];
  for (let a = 0; a <= MAX_A; a++) {
    const row = new Float64Array(6);
    const pmf = Array.from({ length: Math.min(a, m) + 1 }, (_, x) => (total ? (binom(a, x) * binom(unseen - a, m - x)) / total : 0));
    for (let n = 0; n < 6; n++) row[n] = n === 0 ? 1 : pmf.slice(n).reduce((s, v) => s + v, 0);
    table.push(row);
  }
  return table;
}

interface ViewOptions {
  /** 残りのツモの回数（省略時は局の残りの巡） */
  draws?: number;
  /** これから来ると分かっている牌（省略時はネクスト） */
  known?: readonly Tile[];
  /** 見えていない牌の枚数を種類ごとに変える（染め粉の見積もり） */
  scale?: (k: Kind) => number;
  /** 見えている扱いから外す牌（ツモ直しで山に戻す牌など、ないものとして数える） */
  extraSeen?: readonly Tile[];
}

function makeView(s: KyokuState, sit: AiSituation | undefined, o: ViewOptions = {}): View {
  const draws = Math.max(0, o.draws ?? turnLimit(s) - s.turn);
  const next = (o.known ?? visibleNext(s)).slice(0, draws);
  const known = new Int8Array(KIND_COUNT);
  const knownRed = new Int8Array(KIND_COUNT);
  const knownGold = new Int8Array(KIND_COUNT);
  for (const t of next) {
    known[t.kind]++;
    if (t.red) knownRed[t.kind]++;
    if (t.gold) knownGold[t.kind]++;
  }
  const avail = new Int8Array(KIND_COUNT);
  let jokerAvail = 0;
  let unseen = 0;
  const seen = [...allTiles(s), ...s.river, ...s.indicators, ...s.removed, ...next, ...(o.extraSeen ?? [])];
  const redFrac = new Float64Array(KIND_COUNT);
  const goldFrac = new Float64Array(KIND_COUNT);
  for (let k = 0; k < KIND_COUNT; k++) {
    let a = Math.max(0, remainingOf(s, k) - known[k] - (o.extraSeen ?? []).filter((t) => t.kind === k).length);
    if (o.scale) a = Math.round(a * o.scale(k));
    unseen += a;
    if (sit?.composition && a > 0) {
      const red = sit.composition.red[k] - seen.filter((t) => t.kind === k && t.red).length;
      const gold = sit.composition.gold[k] - seen.filter((t) => t.kind === k && t.gold).length;
      redFrac[k] = Math.max(0, Math.min(1, red / a));
      goldFrac[k] = Math.max(0, Math.min(1, gold / a));
    }
    if (isJoker(s, k)) jokerAvail += a;
    else avail[k] = Math.min(MAX_A, a);
  }
  const m = Math.max(0, draws - next.length);
  return {
    draws,
    known,
    knownTotal: next.length,
    avail,
    jokerAvail,
    unseen,
    atLeast: atLeastTable(unseen, m),
    redFrac,
    goldFrac,
    knownRed,
    knownGold,
  };
}

/** 手放したあとに残る牌（種類ごと）。万能牌は種類に数えず、置き場所（手牌か保留枠か）で数える */
interface Kept {
  have: Int8Array;
  /** 手牌（保留枠でない）にある枚数 */
  inHand: Int8Array;
  red: Int8Array;
  gold: Int8Array;
  jokersInHand: number;
  jokersInHold: number;
  /** 牌の数（手牌＋保留枠） */
  size: number;
  /** 保留枠の空き */
  freeSlots: number;
}

interface Placed {
  tile: Tile;
  hold: boolean;
}

function keptOf(s: KyokuState, tiles: readonly Placed[], slots: number): Kept {
  const k: Kept = {
    have: new Int8Array(KIND_COUNT),
    inHand: new Int8Array(KIND_COUNT),
    red: new Int8Array(KIND_COUNT),
    gold: new Int8Array(KIND_COUNT),
    jokersInHand: 0,
    jokersInHold: 0,
    size: tiles.length,
    freeSlots: slots - tiles.filter((t) => t.hold).length,
  };
  for (const { tile, hold } of tiles) {
    if (isJoker(s, tile.kind)) {
      if (hold) k.jokersInHold++;
      else k.jokersInHand++;
      continue;
    }
    k.have[tile.kind]++;
    if (!hold) k.inHand[tile.kind]++;
    if (tile.red) k.red[tile.kind]++;
    if (tile.gold) k.gold[tile.kind]++;
  }
  return k;
}

/** 形ごとの見積もりで、これ以上ツモが要る形は数えない（見込みがほぼなく、数えると遅くなる） */
const MAX_NEED = 2;

/**
 * 残っている牌の候補（手牌・ツモ牌・保留牌すべて）から、見積もりに使う形を絞る。
 * 1 枚手放した後の候補は、どれも全部から 1 枚減らしたものなので、全部に対して足りない枚数が多すぎる形は外せる
 */
function candidateShapes(s: KyokuState, p: Prepared, all: Kept, view: View): Int32Array {
  const sh = p.shapes;
  const jokers = all.jokersInHand + all.jokersInHold;
  const limit = Math.min(view.draws, MAX_NEED) + 1;
  const out: number[] = [];
  // 保留枠がなければ 6 枚の形は作れない
  const six = s.hold.length > 0;
  for (let i = 0; i < sh.count; i++) {
    if (p.banned[i] || (!six && sh.size[i] === 6)) continue;
    const o = sh.offset[i];
    let d = 0;
    for (let j = 0; j < sh.length[i]; j++) {
      const k = sh.kinds[o + j];
      const lack = sh.counts[o + j] - all.have[k];
      if (lack > 0) {
        if (!view.avail[k] && !view.known[k] && !view.jokerAvail && !jokers) {
          d = 99;
          break;
        }
        d += lack;
      }
    }
    if (d - jokers <= limit) out.push(i);
  }
  return Int32Array.from(out);
}

/** 1 局の見積もりに使う、変わらない情報 */
interface Estimator {
  s: KyokuState;
  sit: AiSituation | undefined;
  p: Prepared;
  view: View;
  shapes: Int32Array;
  dealer: boolean;
}

function estimator(s: KyokuState, sit: AiSituation | undefined, all: Kept, view: View): Estimator {
  const p = prepare(s);
  return { s, sit, p, view, shapes: candidateShapes(s, p, all, view), dealer: s.setup.dealer };
}

/** 和了の基本点から、親・本場・役の巻物などを掛けた点数（score.ts の finalizeScore と同じ順） */
const POINTS = Array.from({ length: 40 }, (_, h) => pointsOfHan(h));
const POINTS_NO_LIMIT = Array.from({ length: 40 }, (_, h) => pointsOfHan(h, true));

function finalPoints(s: KyokuState, yakuman: number, han: number, noYaku: boolean, level: number): number {
  const m = s.setup.mods;
  const h = Math.min(39, Math.round(han));
  let pts = yakuman ? YAKUMAN_POINTS * yakuman : (m.noLimit ? POINTS_NO_LIMIT : POINTS)[h];
  if (level > 1) pts = Math.round((pts * level) / 100) * 100;
  if (noYaku && m.cheapHandTimes4) pts *= 4;
  if (s.setup.dealer) pts = Math.ceil((pts * m.dealerMultiplier) / 100) * 100;
  return pts + s.setup.honba * m.honbaBonus;
}

/** 流局の点数の見込み（聴牌料と、親のノーテン罰符を半々に見る） */
function drawDelta(s: KyokuState): number {
  const m = s.setup.mods;
  const stick = s.riichi && !m.riichiStickBack ? s.riichi.stick : 0;
  return 0.5 * m.tenpaiFee - (s.setup.dealer ? 0.5 * notenPenalty(s.setup.honba) : 0) - stick;
}

/**
 * 残した牌から、残りのツモで和了れる見込みの効用。形ごとの見込みを足し合わせ、重なりを割り引いて和了る確率にする
 */
function estimate(e: Estimator, k: Kept): number {
  const { s, p, view, sit } = e;
  const sh = p.shapes;
  const m = s.setup.mods;
  const unknownDraws = view.draws - view.knownTotal;
  const capacity = 4 + s.hold.length + 1;
  let sum = 0;
  let sumU = 0;
  let maxP = 0;
  const needK = [0, 0, 0, 0, 0, 0];
  const needN = [0, 0, 0, 0, 0, 0];
  const riichiHan = s.riichi ? m.riichiHan : 0;
  for (let x = 0; x < e.shapes.length; x++) {
    const i = e.shapes[x];
    const o = sh.offset[i];
    const size = sh.size[i];
    if (size > capacity) continue;
    let lack = 0;
    let fromHold = 0;
    let red = 0;
    let gold = 0;
    let needs = 0;
    for (let j = 0; j < sh.length[i]; j++) {
      const kind = sh.kinds[o + j];
      const c = sh.counts[o + j];
      const h = k.have[kind];
      const used = h < c ? h : c;
      if (used > k.inHand[kind]) fromHold += used - k.inHand[kind];
      red += Math.min(used, k.red[kind]);
      gold += Math.min(used, k.gold[kind]);
      const d = c - h;
      if (d <= 0) continue;
      lack += d;
      const kn = Math.min(d, view.known[kind]);
      red += Math.min(kn, view.knownRed[kind]);
      gold += Math.min(kn, view.knownGold[kind]);
      const fu = d - kn;
      if (fu > 0) {
        needK[needs] = kind;
        needN[needs] = fu;
        needs++;
        red += fu * view.redFrac[kind];
        gold += fu * view.goldFrac[kind];
      }
    }
    if (lack > view.draws + k.jokersInHand + k.jokersInHold) continue;
    // 手元の万能牌で足りない牌を埋める（山に少ない種類から）。手牌の万能牌を先に使う
    let jokers = k.jokersInHand + k.jokersInHold;
    let jokersUsed = 0;
    let unknown = 0;
    for (let a = 0; a < needs; a++) unknown += needN[a];
    while (jokers > 0 && unknown > 0) {
      let best = -1;
      for (let a = 0; a < needs; a++) if (needN[a] > 0 && (best < 0 || view.avail[needK[a]] < view.avail[needK[best]])) best = a;
      needN[best]--;
      unknown--;
      jokers--;
      jokersUsed++;
    }
    // 見えている牌で埋まる分にも万能牌は使える（ツモを待たずに済むが、見積もりでは差を付けない）
    if (unknown > unknownDraws) continue;
    let prob = 1;
    if (unknown > 0) {
      // 山の万能牌は、足りない種類のどれかに使える（種類の数で割って、それぞれの当たりに足す）
      const share = view.jokerAvail ? Math.floor(view.jokerAvail / needs) : 0;
      for (let a = 0; a < needs && prob > 0; a++) {
        if (!needN[a]) continue;
        prob *= view.atLeast[Math.min(MAX_A, view.avail[needK[a]] + share)][needN[a]];
      }
    }
    if (prob <= 0) continue;
    const jokerFromHold = jokersUsed > k.jokersInHand;
    const menzen = size === 5 && !fromHold && !jokerFromHold;
    let han = p.han[i] + riichiHan;
    if (p.yakuman[i] === 0) {
      if (menzen) han += m.menzenHan;
      if (!m.noBonus) {
        han += red * m.redHan;
        if (m.doraMode === 'jokerPlus') han += jokersUsed;
      }
    }
    const pts = finalPoints(s, p.yakuman[i], han, !!p.noYaku[i], p.level[i]) + gold * GOLD_POINTS;
    sum += prob;
    sumU += prob * utility(pts, sit, e.dealer, true);
    if (prob > maxP) maxP = prob;
  }
  const drawU = utility(drawDelta(s), sit, e.dealer, false);
  if (sum <= 0) return drawU;
  // 形どうしは同じ牌を待つことが多いので、見込みの和をそのまま確率にせず、重なりを割り引く
  const pWin = 1 - (1 - Math.min(1, maxP)) * Math.exp(-0.5 * (sum - maxP));
  return pWin * (sumU / sum) + (1 - pWin) * drawU;
}

/* ---------- 局の手 ---------- */

interface Candidate {
  move: KyokuMove;
  kept: Placed[];
  /** 打牌なら捨てる牌（リーチの判定に使う） */
  discard?: { zone: Zone; index: number };
}

/** 手牌・ツモ牌・保留牌から作れる手（打牌と保留）。同じ牌（種類・赤・金が同じで置き場所の種類も同じ）は 1 つにまとめる */
function candidates(hand: readonly Tile[], drawn: readonly Tile[], hold: readonly (Tile | null)[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const sig = (zone: string, t: Tile) => `${zone}:${t.kind}:${+!!t.red}:${+!!t.gold}`;
  const holds = hold.flatMap((t) => (t ? [{ tile: t, hold: true }] : []));
  const inHand = (ts: readonly Tile[]) => ts.map((t) => ({ tile: t, hold: false }));
  const [first, ...restDrawn] = drawn;
  hand.forEach((t, index) => {
    const key = sig('hand', t);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      move: { type: 'discard', zone: 'hand', index },
      kept: [...inHand(hand.filter((_, i) => i !== index)), ...inHand(drawn), ...holds],
      discard: { zone: 'hand', index },
    });
  });
  drawn.forEach((t, index) => {
    const key = sig('drawn', t);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      move: { type: 'discard', zone: 'drawn', index },
      kept: [...inHand(hand), ...inHand(drawn.filter((_, i) => i !== index)), ...holds],
      discard: { zone: 'drawn', index },
    });
  });
  hold.forEach((t, index) => {
    if (!t) return;
    const key = sig('hold', t);
    if (seen.has(key)) return;
    seen.add(key);
    // 保留牌を捨てると、空いた枠にツモ牌が入る
    const others = holds.filter((h) => h.tile !== t);
    out.push({
      move: { type: 'discard', zone: 'hold', index },
      kept: [...inHand(hand), ...inHand(restDrawn), ...others, ...(first ? [{ tile: first, hold: true }] : [])],
      discard: { zone: 'hold', index },
    });
  });
  const slot = hold.indexOf(null);
  if (slot >= 0 && first) {
    out.push({
      move: { type: 'hold', zone: 'drawn', index: 0, slot },
      kept: [...inHand(hand), ...inHand(restDrawn), ...holds, { tile: first, hold: true }],
    });
    hand.forEach((t, index) => {
      const key = sig('holdHand', t);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        move: { type: 'hold', zone: 'hand', index, slot },
        kept: [...inHand(hand.filter((_, i) => i !== index)), ...inHand(drawn), ...holds, { tile: t, hold: true }],
      });
    });
  }
  return out;
}

interface Choice {
  move: KyokuMove;
  value: number;
}

/** 手元の牌の並び（局の状態の代わりに、消耗品を使ったあとの見込みを測るときに渡す） */
interface Tiles {
  hand: readonly Tile[];
  drawn: readonly Tile[];
  hold: readonly (Tile | null)[];
}

const tilesOf = (s: KyokuState): Tiles => ({ hand: s.hand, drawn: s.drawn, hold: s.hold });

function placedAll(t: Tiles): Placed[] {
  return [
    ...t.hand.map((tile) => ({ tile, hold: false })),
    ...t.drawn.map((tile) => ({ tile, hold: false })),
    ...t.hold.flatMap((tile) => (tile ? [{ tile, hold: true }] : [])),
  ];
}

/** いちばん見込みの高い打牌か保留。riichi ならリーチしたほうが得かも比べる */
function bestMove(s: KyokuState, sit: AiSituation | undefined, t: Tiles, view: View, riichi: boolean): Choice {
  const slots = s.hold.length;
  const e = estimator(s, sit, keptOf(s, placedAll(t), slots), view);
  let best: (Choice & { c: Candidate }) | null = null;
  for (const c of candidates(t.hand, t.drawn, t.hold)) {
    const value = estimate(e, keptOf(s, c.kept, slots));
    if (!best || value > best.value) best = { move: c.move, value, c };
  }
  const b = best!;
  if (riichi && b.c.discard && view.draws > 0 && !s.riichi) {
    const r = riichiValue(e, b.c);
    if (r !== null && r > b.value) return { move: { type: 'riichi', ...b.c.discard }, value: r };
  }
  return { move: b.move, value: b.value };
}

/**
 * 手を固めてリーチしたときの効用。待ちの牌ごとに、和了の点数（リーチの翻と、宣言からの巡のボーナスを足す）と
 * 引ける確率を求める。ネクストで見えている待ちの牌は必ず引ける
 */
function riichiValue(e: Estimator, c: Candidate): number | null {
  const { s, sit, view } = e;
  if (!c.discard || !canRiichi(s, c.discard.zone, c.discard.index)) return null;
  const tiles = c.kept.map((p) => p.tile);
  const w = waits(tiles, winContext(s, false));
  if (!w || !w.length) return null;
  const m = s.setup.mods;
  const ctx = winContext(s, true);
  const holdIds = new Set(c.kept.filter((p) => p.hold).map((p) => p.tile.id));
  ctx.holdIds = holdIds;
  const fctx = finalizeContext(s);
  const next = visibleNext(s).slice(0, view.draws);
  const firstKnown = next.findIndex((t) => w.includes(t.kind));
  const pointsFor = (kind: Kind, turns: number) => {
    const win = bestWin([...tiles, { id: -1, kind }], ctx);
    if (!win) return 0;
    const ev = addHan(win.evaluation, [yakuEntry('リーチ', m.riichiHan)]);
    return finalizeScore(ev, { ...fctx, riichiTurns: turns }).points;
  };
  const drawU = utility(m.tenpaiFee - (m.riichiStickBack ? 0 : m.riichiCost), sit, e.dealer, false);
  if (firstKnown >= 0) return utility(pointsFor(next[firstKnown].kind, firstKnown + 1), sit, e.dealer, true);
  const draws = view.draws - next.length;
  const outs = w.reduce((a, k) => a + (isJoker(s, k) ? 0 : view.avail[k]), 0) + view.jokerAvail;
  if (!outs || draws <= 0) return drawU;
  const pNone = binom(view.unseen - outs, draws) / binom(view.unseen, draws);
  const turns = next.length + Math.max(1, Math.round(draws / 2));
  let u = 0;
  for (const k of w) {
    const a = isJoker(s, k) ? 0 : view.avail[k];
    if (a) u += (a / outs) * utility(pointsFor(k, turns), sit, e.dealer, true);
  }
  // 山の万能牌は、待ちのうちいちばん高い牌として数える
  if (view.jokerAvail) u += (view.jokerAvail / outs) * Math.max(...w.map((k) => utility(pointsFor(k, turns), sit, e.dealer, true)));
  return (1 - pNone) * u + pNone * drawU;
}

/** 今のツモで和了ったときの効用 */
function winNowValue(s: KyokuState, sit: AiSituation | undefined): number {
  const w = s.win!;
  const score = finalizeScore(w.evaluation, finalizeContext(s));
  const used = new Set(w.tileIds);
  const gold = allTiles(s).filter((t) => used.has(t.id) && t.gold).length;
  return utility(score.points + gold * GOLD_POINTS, sit, s.setup.dealer, true);
}

/** 和了らずに続けるのは、見込みがこの倍率を超えるときだけ（見積もりは甘めに出るので、確かな和了を優先する） */
const CONTINUE_MARGIN = 1.15;
/** 配牌の引き直しは、配り直した手の見込み（の平均）がこの倍率を超えるときだけ */
const REDEAL_MARGIN = 1.25;
/** 消耗品は、見込みがこの倍率を超えて上がるときだけ使う */
const CONSUMABLE_MARGIN = 1.2;

export interface SmartOptions {
  /** 聴牌でリーチを考える（既定は true） */
  riichi?: boolean;
  /** 消耗品と延長を使う（既定は true） */
  consumables?: boolean;
}

/** 局の中の手。消耗品（持っている順の番号）と延長を含む */
export type SmartKyokuAction =
  | KyokuMove
  | { type: 'useConsumable'; index: number; color?: number }
  | { type: 'extend' };

/**
 * 局の 1 手を選ぶ。consumables は持っている消耗品（ランの外で局だけを遊ばせるときは空）
 */
export function smartKyokuAction(
  s: KyokuState,
  sit?: AiSituation,
  consumables: readonly ConsumableId[] = [],
  opts: SmartOptions = {},
): SmartKyokuAction {
  if (s.result) throw new Error('kyoku has ended');
  const useItems = opts.consumables ?? true;
  const riichi = opts.riichi ?? true;
  const use = (id: ConsumableId) => (useItems ? consumables.indexOf(id) : -1);
  const has = (id: ConsumableId) => use(id) >= 0 && canUseConsumable(s, id);

  // 巡を延ばす（最終巡。延長札が先、なければ祝儀で）
  if (useItems && canExtend(s)) {
    const now = s.win ? winNowValue(s, sit) : utility(drawDelta(s), sit, s.setup.dealer, false);
    const extended = s.riichi
      ? riichiNow(s, sit, EXTEND_TURNS)
      : bestMove(s, sit, tilesOf(s), makeView(s, sit, { draws: EXTEND_TURNS }), false).value;
    const gain = extended - now;
    const mv = sit?.moneyValue ?? 0;
    if (has('encho') && gain > 3 * mv) return { type: 'useConsumable', index: use('encho') };
    if (sit && sit.money >= EXTEND_PRICE && gain > EXTEND_PRICE * mv) return { type: 'extend' };
  }

  if (s.riichi) return s.win ? { type: 'tsumo' } : { type: 'discard', zone: 'drawn', index: 0 };

  const view = makeView(s, sit);
  const best = bestMove(s, sit, tilesOf(s), view, riichi);
  if (s.win) {
    const now = winNowValue(s, sit);
    if (view.draws === 0 || now * CONTINUE_MARGIN >= best.value) return { type: 'tsumo' };
  }

  // 配牌の引き直しと総入れ替え（配り直した手の見込みの平均と比べる）
  const redeal = canRedeal(s);
  const irekae = !redeal && s.turn <= 2 && has('irekae');
  if (redeal || irekae) {
    const fresh = freshHandValue(s, sit);
    const margin = redeal ? REDEAL_MARGIN : REDEAL_MARGIN * 1.6;
    if (fresh > best.value * margin && !s.win) return redeal ? { type: 'redeal' } : { type: 'useConsumable', index: use('irekae') };
  }

  if (has('nozoki') && s.turn <= 2 && !s.win) return { type: 'useConsumable', index: use('nozoki') };

  // 染め粉（序盤に、残す色ごとの見込みを比べる）
  if (has('some') && s.turn <= 3 && !s.win) {
    let bestColor = -1;
    let bestValue = best.value * CONSUMABLE_MARGIN;
    for (let color = 0; color < SOME_COLORS.length; color++) {
      const v = bestMove(s, sit, tilesOf(s), makeView(s, sit, { known: [], scale: (k) => (suit(k) === color ? 1 : 0.5) }), false).value;
      if (v > bestValue) {
        bestValue = v;
        bestColor = color;
      }
    }
    if (bestColor >= 0) return { type: 'useConsumable', index: use('some'), color: bestColor };
  }

  // ツモ直し: 今のツモ牌を山の底に戻し、ネクストの先頭を引く（ネクストが見えないときは使わない）
  if (has('tsumo') && !s.win) {
    const next = visibleNext(s);
    if (next.length && s.drawn.length === 1) {
      const swapped: Tiles = { hand: s.hand, drawn: [next[0]], hold: s.hold };
      const v = bestMove(s, sit, swapped, makeView(s, sit, { known: next.slice(1), extraSeen: [next[0]] }), false).value;
      if (v > best.value * CONSUMABLE_MARGIN) return { type: 'useConsumable', index: use('tsumo') };
    }
  }

  // 河拾い: 最後に捨てた牌をもう 1 枚のツモ牌にする
  if (has('hiroi') && !s.win) {
    const picked = s.river[s.river.length - 1];
    const t: Tiles = { hand: s.hand, drawn: [...s.drawn, picked], hold: s.hold };
    const all = [...allTiles(s), picked];
    const ctx = winContext(s, true);
    const win = bestWin(all, ctx);
    const v = win ? Infinity : bestMove(s, sit, t, view, false).value;
    if (v > best.value * CONSUMABLE_MARGIN * 1.2) return { type: 'useConsumable', index: use('hiroi') };
  }

  return best.move;
}

/** リーチ中に、残りのツモ draws 回で和了れる見込み（延長の判断に使う） */
function riichiNow(s: KyokuState, sit: AiSituation | undefined, draws: number): number {
  const tiles = [...s.hand, ...(s.hold.filter(Boolean) as Tile[])];
  const w = waits(tiles, winContext(s, false));
  const drawU = utility(drawDelta(s), sit, s.setup.dealer, false);
  if (!w || !w.length) return drawU;
  const view = makeView(s, sit, { draws, known: [] });
  const outs = w.reduce((a, k) => a + (isJoker(s, k) ? 0 : view.avail[k]), 0) + view.jokerAvail;
  if (!outs) return drawU;
  const pNone = binom(view.unseen - outs, draws) / binom(view.unseen, draws);
  const ctx = winContext(s, true);
  const m = s.setup.mods;
  const fctx = finalizeContext(s);
  let u = 0;
  for (const k of w) {
    const a = isJoker(s, k) ? 0 : view.avail[k];
    const win = a ? bestWin([...tiles, { id: -1, kind: k }], ctx) : null;
    if (!win) continue;
    const ev = addHan(win.evaluation, [yakuEntry('リーチ', m.riichiHan)]);
    u += (a / outs) * utility(finalizeScore(ev, { ...fctx, riichiTurns: s.turn - s.riichi!.turn + 1 }).points, sit, s.setup.dealer, true);
  }
  return (1 - pNone) * u + pNone * drawU;
}

/** 配り直したときの見込みの平均。見えていない牌（と手放す牌）から 5 枚を何通りか選んで測る */
function freshHandValue(s: KyokuState, sit: AiSituation | undefined): number {
  const SAMPLES = 6;
  const pool: Kind[] = [];
  for (let k = 0; k < KIND_COUNT; k++) for (let i = 0; i < remainingOf(s, k); i++) pool.push(k);
  for (const t of [...s.hand, ...s.drawn]) pool.push(t.kind);
  // 乱数は手元の牌から決める（山の並びに頼らず、同じ状態からは同じ判断になるように）
  let rng = mix32(s.hand.reduce((a, t) => a * 31 + t.id + 1, s.drawn[0]?.id ?? 7)) || 1;
  let total = 0;
  for (let n = 0; n < SAMPLES; n++) {
    const left = pool.slice();
    const picked: Tile[] = [];
    for (let i = 0; i < 5; i++) {
      let j: number;
      [rng, j] = nextInt(rng, left.length);
      picked.push({ id: -100 - i, kind: left.splice(j, 1)[0] });
    }
    const t: Tiles = { hand: picked.slice(0, 4), drawn: [picked[4]], hold: s.hold };
    const view = makeView(s, sit, { known: [] });
    total += bestMove(s, sit, t, view, false).value;
  }
  return total / SAMPLES;
}

/* ---------- ラン（精算・ショップ） ---------- */

/** ランの状況（効用の重み付けに使う） */
export function situationOf(run: RunState): AiSituation {
  const r = run.round;
  const need = orasuNeed(run);
  return {
    need: r.target - r.score,
    target: r.target,
    lastKyoku: r.kyoku >= KYOKU_PER_WAVE - 1,
    orasuMin: need !== null && r.orasuWin < need ? need : null,
    // 祝儀 1 は、その場の目標点の 1/40 ほどの値打ちと見る（アイテムが場の点数を何割か押し上げる目安）
    moneyValue: r.target / 40,
    money: run.money,
    composition: run.composition,
  };
}

/**
 * 親の和了のあと連荘するか。連荘はもう 1 局遊べるので基本は続けるが、場の最後の局で目標に届いているのに、
 * 流局の罰符（とリーチ棒）で目標を割る恐れがあるときはやめる。オーラスの和了の条件（段位）をまだ満たして
 * いなければ、和了やめると負けるので続ける
 */
export function smartRenchan(run: RunState, points: number): boolean {
  const r = run.round;
  if (r.kyoku < KYOKU_PER_WAVE - 1) return true;
  const need = orasuNeed(run);
  if (need !== null && Math.max(r.orasuWin, points) < need) return true;
  const after = r.score + points;
  return after < r.target || after - notenPenalty(r.honba + 1) - 300 >= r.target;
}

/** アイテムの価値の目安（祝儀に換算）。持ち物と雀士で変わる */
function charmValue(run: RunState, id: CharmId): number {
  const eq = (e: EquipId) => run.equipment.includes(e);
  const charms = ownedCharms(run);
  const holdSlots = run.base.holdSlots + (eq('hold') ? 1 : 0);
  const reds = run.composition.red.reduce((a, n) => a + n, 0);
  switch (id) {
    case 'hayazashi':
      return 6;
    case 'yasude':
      return 3;
    case 'damaten':
      return holdSlots <= 2 ? 7 : 5;
    case 'ippatsuya':
      return 3;
    case 'bakuchi':
      return 3;
    case 'ura2':
      return 3;
    case 'oyaji':
      return 5 + (charms.includes('isuwari') || eq('kamiza') ? 1 : 0);
    case 'isuwari':
      return 2 + (charms.includes('oyaji') ? 1 : 0);
    case 'akaito':
      return 3 + Math.floor(reds / 3);
    case 'iromegane':
      return 5;
    case 'tobiishi':
      return 6;
    case 'kazamidori':
      return 4;
    case 'hakushi':
      return 9 + (run.composition.count[HAKU] >= 5 ? 3 : 0);
    case 'chokin':
      return 1;
    case 'nolimit':
      return run.wave >= 1 ? 10 : 7;
  }
}

function equipValue(run: RunState, id: EquipId): number {
  const eq = (e: EquipId) => run.equipment.includes(e);
  const charms = ownedCharms(run);
  switch (id) {
    case 'hold':
      // かめ（保留なし）は、保留牌を使うと門前を失う
      return charms.includes('damaten') ? 6 : 10;
    case 'next':
      return 8;
    case 'turns':
      return 10;
    case 'dora2':
      return eq('joker') ? 11 : 5;
    case 'joker':
      return 11;
    case 'jokerplus':
      return 7;
    case 'kamiza':
      return 4 + (charms.includes('oyaji') ? 2 : 0);
    case 'heijoshin':
      return 4;
    case 'meguri':
      return 4;
  }
}

const CONSUMABLE_VALUES: Record<ConsumableId, number> = { tsumo: 3, hiroi: 2, nozoki: 2, irekae: 3, some: 3, encho: 4 };

/** AI の和了でよく付く役（役の巻物の価値の目安。sim の和了の内訳から決めた大まかな割合） */
const YAKU_SHARE: Record<string, number> = {
  門前: 0.35,
  役牌: 0.25,
  断么九: 0.2,
  プチ四暗刻: 0.12,
  混一色: 0.1,
  三対子: 0.08,
  清一色: 0.05,
  プチ三色: 0.04,
  プチ一通: 0.03,
  プチ国士: 0.03,
  プチ小四喜: 0.01,
  プチ小三元: 0.01,
};

function scrollValue(run: RunState, yaku: string): number {
  let share = YAKU_SHARE[yaku] ?? 0.02;
  if (yaku === '門前') {
    const holdSlots = run.base.holdSlots + (run.equipment.includes('hold') ? 1 : 0);
    share = holdSlots === 0 ? 0.7 : holdSlots <= 2 ? 0.45 : share;
  }
  return 2 + 12 * share * 1.2 ** (run.yakuLevels[yaku] ?? 0);
}

/** 牌の改造の対象。選べる種類がなければ null */
function modTarget(run: RunState, id: ModId): Kind | null {
  const comp = run.composition;
  const hakushi = ownedCharms(run).includes('hakushi');
  const pick = (order: readonly Kind[]) => order.find((k) => canModify(comp, id, k)) ?? null;
  // 順子にも刻子にも使う真ん中の数牌から（5・4・6 の順）
  const middles = [4, 13, 22, 3, 12, 21, 5, 14, 23];
  switch (id) {
    case 'shu':
      return pick(middles);
    case 'kin':
      return pick([3, 12, 21, 5, 14, 23, 4, 13, 22]);
    case 'utsushi':
      // 白紙委任があれば白（万能牌）を増やす。なければ役牌になる中
      return pick(hakushi ? [HAKU, CHUN] : [CHUN, ...middles]);
    case 'nuki':
      // 役牌になりにくい風牌から抜く（風見鶏があれば数牌の 9 から）
      return pick(ownedCharms(run).includes('kazamidori') ? [8, 17, 26] : [NORTH, WEST, 8, 17, 26]);
  }
}

function modValue(run: RunState, id: ModId): number {
  const charms = ownedCharms(run);
  switch (id) {
    case 'shu':
      return 4 + (charms.includes('akaito') ? 3 : 0);
    case 'kin':
      // 祝儀が増える改造なので、先の場が多いほど価値がある
      return 1 + (WAVE_COUNT - run.wave);
    case 'nuki':
      return 2;
    case 'utsushi':
      return charms.includes('hakushi') ? 9 : 3;
  }
}

/** ショップの品の価値（祝儀に換算。買えない品は -Infinity） */
function offerValue(run: RunState, o: Offer): number {
  switch (o.kind) {
    case 'charm':
      return charmValue(run, o.id);
    case 'equip':
      return equipValue(run, o.id);
    case 'consumable':
      return CONSUMABLE_VALUES[o.id];
    case 'scroll':
      return scrollValue(run, o.yaku);
    case 'mod':
      return modTarget(run, o.id) === null ? -Infinity : modValue(run, o.id);
  }
}

/** 買うのは価値が値段を超える品。祝儀の利子（5 につき 1）を残したいので、最後の場の前は少し厳しくする */
const buyMargin = (run: RunState) => (run.wave >= WAVE_COUNT - 1 ? -1 : 0);

/** ショップの 1 手 */
export function smartShopAction(run: RunState, opts: { gacha?: boolean } = {}): GameAction {
  const allowGacha = opts.gacha ?? true;
  // 福引き券はただなので先に使う
  if (allowGacha && canGacha(run) && run.gachaTickets > 0) return { type: 'gacha' };
  const offers = run.shop ?? [];
  let best = -1;
  let bestGain = -Infinity;
  offers.forEach((o, i) => {
    if (o.sold) return;
    const gain = offerValue(run, o) - o.price;
    const blocker = buyBlocker(run, i);
    if (blocker === 'charmsFull' && o.kind === 'charm') {
      // お守りの枠がいっぱいなら、いちばん弱いお守りを売って買い替える
      const weakest = Math.min(...run.charms.map((c) => charmValue(run, c)));
      if (gain - weakest > 2 && run.money + SELL_PRICES.charm >= o.price && gain > bestGain) {
        bestGain = gain;
        best = i;
      }
      return;
    }
    if (blocker) return;
    if (gain >= buyMargin(run) && gain > bestGain) {
      bestGain = gain;
      best = i;
    }
  });
  if (best >= 0) {
    const o = offers[best];
    if (o.kind === 'charm' && run.charms.length >= MAX_CHARMS) {
      const values = run.charms.map((c) => charmValue(run, c));
      return { type: 'sell', index: values.indexOf(Math.min(...values)) };
    }
    return o.kind === 'mod' ? { type: 'buy', index: best, target: modTarget(run, o.id)! } : { type: 'buy', index: best };
  }
  // 買う品がなく、祝儀に余裕があれば福引き（景品の平均はショップより少し得）、さらに余れば品替え
  if (allowGacha && canGacha(run) && run.money >= GACHA.price + 4) return { type: 'gacha' };
  if (run.money >= REROLL_PRICE + 10) return { type: 'reroll' };
  return { type: 'leave' };
}

/** 全体の 1 手（局・精算・ショップ）。sim と、画面の CPU から使う */
export function smartAction(g: GameState, opts: SmartOptions & { shop?: boolean; gacha?: boolean } = {}): GameAction {
  if (g.run.phase === 'shop') return opts.shop === false ? { type: 'leave' } : smartShopAction(g.run, opts);
  const k = g.kyoku;
  if (!k) throw new Error('no kyoku in progress');
  if (k.result) {
    const r = k.result;
    return { type: 'settle', renchan: r.type === 'win' && isDealerKyoku(g.run) && smartRenchan(g.run, r.score.points) };
  }
  return smartKyokuAction(k, situationOf(g.run), g.run.consumables, opts);
}
