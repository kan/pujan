/**
 * 役判定。5 枚（対子＋面子、または特殊形）と、三対子の 6 枚を判定する。
 * 仕様は docs/SPEC.md §3.3「役」。
 */
import { DRAGONS, GREEN, NINES, ONES, WINDS, isYaochu, num, suit, type Kind } from './tiles.js';

/** 役判定に効くルールの切り替え（場風・自風と、お守りによる「言い張り」） */
export interface HandRules {
  /** 場風 */
  bakaze: Kind;
  /** 自風 */
  seat: Kind;
  /** 色眼鏡: 萬子と索子を同じ色として扱う */
  sameColorManSou?: boolean;
  /** 飛び石: 147・258・369 を順子として扱う */
  skipSequences?: boolean;
  /** 風見鶏: すべての風牌が役牌 */
  allWindsYakuhai?: boolean;
  /** 巡り目: 891・912 を順子として扱う */
  wrapSequences?: boolean;
}

export interface YakuEntry {
  name: string;
  /** 翻数（役満の役では 0） */
  han: number;
  /** 役満の倍数（通常の役では 0） */
  yakuman: number;
}

export interface Evaluation {
  /** 役満の合計倍数。0 なら通常の役 */
  yakuman: number;
  /** 翻数の合計（役満のときは使わない） */
  han: number;
  yaku: YakuEntry[];
  /** 役が 1 つもない（ドラや門前などのボーナスは役に数えない） */
  noYaku: boolean;
}

const yaku = (name: string, han: number): YakuEntry => ({ name, han, yakuman: 0 });
const yakumanEntry = (name: string, times: number): YakuEntry => ({ name, han: 0, yakuman: times });

/** 色眼鏡を考慮した色 */
function colorOf(k: Kind, rules: HandRules): number {
  const s = suit(k);
  return rules.sameColorManSou && s === 2 ? 0 : s;
}

type MeldKind = 'triplet' | 'sequence' | 'sanshoku';

function meldKind(a: Kind, b: Kind, c: Kind, rules: HandRules): MeldKind | null {
  if (a === b && b === c) return 'triplet';
  const sorted = [a, b, c].sort((x, y) => x - y);
  if (sorted[2] < 27) {
    if (colorOf(a, rules) === colorOf(b, rules) && colorOf(b, rules) === colorOf(c, rules)) {
      const n = [num(a), num(b), num(c)].sort((x, y) => x - y);
      if (n[1] === n[0] + 1 && n[2] === n[0] + 2) return 'sequence';
      if (rules.skipSequences && n[1] === n[0] + 3 && n[2] === n[0] + 6) return 'sequence';
      // 891 は [0, 7, 8]、912 は [0, 1, 8]（num は数字から 1 を引いた値）
      if (rules.wrapSequences && n[0] === 0 && n[2] === 8 && (n[1] === 1 || n[1] === 7)) return 'sequence';
    }
    if (num(a) === num(b) && num(b) === num(c) && new Set([suit(a), suit(b), suit(c)]).size === 3) {
      return 'sanshoku';
    }
  }
  return null;
}

interface Decomposition {
  pair: Kind;
  meld: MeldKind;
  rest: Kind[];
}

function counts(kinds: readonly Kind[]): Map<Kind, number> {
  const m = new Map<Kind, number>();
  for (const k of kinds) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function withoutOnce(kinds: readonly Kind[], remove: readonly Kind[]): Kind[] | null {
  const rest = kinds.slice();
  for (const r of remove) {
    const i = rest.indexOf(r);
    if (i < 0) return null;
    rest.splice(i, 1);
  }
  return rest;
}

/**
 * 和了形になりうるかの手早い判定（待ちの計算で大量に呼ばれるので、ほとんどの手をここで落とす）。
 * 対子も刻子もない 5 枚で和了形になるのは、プチ一通（同色の 5 連）とプチ大四喜（東南西北＋三元牌）だけ。
 */
function mayWin(kinds: readonly Kind[]): boolean {
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) if (kinds[i] === kinds[j]) return true;
  // 数牌だけならプチ一通の可能性がある（色眼鏡で色の扱いが変わるので、判定は本体に任せる）
  if (kinds.every((k) => k < 27)) return true;
  return WINDS.every((w) => kinds.includes(w));
}

/** 5 枚の手を判定する。和了形でなければ null */
export function evaluateFive(kinds: readonly Kind[], rules: HandRules): Evaluation | null {
  if (kinds.length !== 5) throw new Error('evaluateFive needs 5 tiles');
  if (!mayWin(kinds)) return null;
  const c = counts(kinds);
  const n = (k: Kind) => c.get(k) ?? 0;
  const distinct = [...c.keys()];

  const decs: Decomposition[] = [];
  for (const p of distinct) {
    if (n(p) < 2) continue;
    const rest = withoutOnce(kinds, [p, p])!.sort((x, y) => x - y);
    const m = meldKind(rest[0], rest[1], rest[2], rules);
    if (m) decs.push({ pair: p, meld: m, rest });
  }
  const normal = decs.filter((d) => d.meld === 'triplet' || d.meld === 'sequence');

  const categories = [DRAGONS, WINDS, ONES, NINES];
  const kokushi =
    distinct.length === 4 &&
    Math.max(...distinct.map(n)) === 2 &&
    categories.every((cat) => distinct.filter((k) => cat.includes(k)).length === 1);
  const daisuushi = WINDS.every((w) => n(w) === 1) && DRAGONS.some((d) => n(d) === 1);
  const shousuushi = distinct.some((p) => {
    if (n(p) < 2) return false;
    const rest = withoutOnce(kinds, [p, p])!;
    return rest.every((k) => WINDS.includes(k)) && new Set(rest).size === 3;
  });
  const shousangen =
    DRAGONS.every((d) => n(d) >= 1) &&
    (() => {
      const rest = withoutOnce(kinds, DRAGONS)!;
      return rest[0] === rest[1];
    })();
  const daisangen = DRAGONS.some((d) => n(d) === 3 && DRAGONS.every((e) => e === d || n(e) === 1));
  const kan = distinct.some((k) => n(k) >= 4);
  const run5 =
    kinds.every((k) => k < 27) &&
    new Set(kinds.map((k) => colorOf(k, rules))).size === 1 &&
    (() => {
      const ns = kinds.map(num).sort((x, y) => x - y);
      return ns.every((v, i) => v === ns[0] + i);
    })();

  if (!decs.length && !run5 && !kan && !kokushi && !daisuushi && !shousuushi && !shousangen && !daisangen) {
    return null;
  }

  const allHonor = kinds.every((k) => k >= 27);
  const allGreen = kinds.every((k) => GREEN.has(k));
  const allYaochu = kinds.every(isYaochu);
  const hasTriplet = normal.some((d) => d.meld === 'triplet');

  const ym: YakuEntry[] = [];
  if (daisangen) ym.push(yakumanEntry('プチ大三元', 2));
  if (kan) ym.push(yakumanEntry('プチ槓', 1));
  if (daisuushi) ym.push(yakumanEntry('プチ大四喜', 1));
  // プチ大四喜とプチ大三元は 5 枚がすべて字牌なので、字一色を足すといつもダブル以上になる。点数が跳ねすぎないように足さない
  if (allHonor && !daisuushi && !daisangen) ym.push(yakumanEntry('字一色', 1));
  if (allGreen) ym.push(yakumanEntry('緑一色', 1));
  if (allYaochu && hasTriplet && !allHonor) ym.push(yakumanEntry('混老頭', 1));
  if (ym.length) {
    return { yakuman: ym.reduce((a, y) => a + y.yakuman, 0), han: 0, yaku: ym, noYaku: false };
  }

  const y: YakuEntry[] = [];
  if (kokushi) y.push(yaku('プチ国士', 1));
  if (kinds.every((k) => !isYaochu(k))) y.push(yaku('断么九', 1));
  const colors = new Set(kinds.filter((k) => k < 27).map((k) => colorOf(k, rules)));
  if (colors.size === 1) {
    y.push(kinds.some((k) => k >= 27) ? yaku('混一色', 2) : yaku('清一色', 3));
  }
  if (run5) y.push(yaku('プチ一通', 2));
  if (decs.some((d) => d.meld === 'sanshoku')) y.push(yaku('プチ三色', 2));
  if (shousuushi) y.push(yaku('プチ小四喜', 2));
  if (shousangen) y.push(yaku('プチ小三元', 5));

  const yakuhaiValue = (k: Kind) =>
    (DRAGONS.includes(k) ? 1 : 0) +
    (k === rules.bakaze ? 1 : 0) +
    (k === rules.seat ? 1 : 0) +
    (rules.allWindsYakuhai && WINDS.includes(k) && k !== rules.bakaze && k !== rules.seat ? 1 : 0);
  let yakuhai = 0;
  for (const d of normal) {
    yakuhai = Math.max(yakuhai, yakuhaiValue(d.pair) + (d.meld === 'triplet' ? yakuhaiValue(d.rest[0]) : 0));
  }
  if (yakuhai) y.push(yaku('役牌', yakuhai));
  if (hasTriplet) y.push(yaku('プチ四暗刻', 3));

  const han = y.reduce((a, e) => a + e.han, 0);
  return { yakuman: 0, han, yaku: y, noYaku: han === 0 };
}

/** 6 枚の三対子を判定する（対子 3 組だけ） */
export function evaluateSix(kinds: readonly Kind[], rules: HandRules): Evaluation | null {
  if (kinds.length !== 6) throw new Error('evaluateSix needs 6 tiles');
  // 対子 3 組なら、どの牌も同じ種類がちょうど 2 枚ある
  for (const k of kinds) {
    let n = 0;
    for (const x of kinds) if (x === k) n++;
    if (n !== 2) return null;
  }
  if (kinds.every((k) => k >= 27)) {
    return { yakuman: 1, han: 0, yaku: [yakumanEntry('三対子・字一色', 1)], noYaku: false };
  }
  const y: YakuEntry[] = [yaku('三対子', 2)];
  if (kinds.every((k) => !isYaochu(k))) y.push(yaku('断么九', 1));
  const colors = new Set(kinds.filter((k) => k < 27).map((k) => colorOf(k, rules)));
  if (colors.size === 1) y.push(kinds.some((k) => k >= 27) ? yaku('混一色', 2) : yaku('清一色', 3));
  const han = y.reduce((a, e) => a + e.han, 0);
  return { yakuman: 0, han, yaku: y, noYaku: false };
}

/** ボーナスの翻（門前、ドラ、赤、リーチなど）を足す。役満には足さない */
export function addHan(ev: Evaluation, extra: readonly YakuEntry[]): Evaluation {
  if (!extra.length || ev.yakuman) return ev;
  const han = ev.han + extra.reduce((a, e) => a + e.han, 0);
  return { ...ev, han, yaku: [...ev.yaku, ...extra] };
}

/** 天和・地和のような役満を重ねる */
export function addYakuman(ev: Evaluation, name: string, times = 1): Evaluation {
  const keep = ev.yakuman ? ev.yaku : [];
  return { yakuman: ev.yakuman + times, han: 0, yaku: [yakumanEntry(name, times), ...keep], noYaku: false };
}

export { yaku as yakuEntry };
