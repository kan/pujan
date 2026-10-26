/**
 * 手元の牌（手牌・ツモ牌・保留牌）から、いちばん点の高い和了を探す。
 *
 * 5 枚の組み合わせと（6 枚以上あれば）三対子の 6 枚を全部試し、万能牌は取りうる種類を全部当てはめる。
 * ボーナスの翻（門前・ドラ・赤）は組み合わせごとに変わるので、ここで足してから比べる。
 */
import { addHan, evaluateFive, evaluateSix, yakuEntry, type Evaluation, type HandRules, type YakuEntry } from './hand.js';
import { basePoints } from './score.js';
import { DRAGONS, GREEN, KIND_COUNT, NINES, ONES, WINDS, suit, type Kind, type Tile } from './tiles.js';

export type DoraMode = 'normal' | 'joker' | 'jokerPlus';

export interface WinContext {
  rules: HandRules;
  /** 万能牌として扱う種類 */
  isJoker: (k: Kind) => boolean;
  /** 山にある種類ごとの枚数（牌の改造で 0〜5 になる） */
  copies: (k: Kind) => number;
  /** 保留枠にある牌の id。ボーナス（門前・ドラ・赤）を付けるときだけ渡す */
  holdIds?: ReadonlySet<number>;
  /** ドラの種類（表示牌の次の牌）。ドラ表示が 2 枚なら 2 つ */
  doraKinds: readonly Kind[];
  doraMode: DoraMode;
  /** 門前の翻（通常 1、黙聴で 2） */
  menzenHan: number;
  /** 赤牌 1 枚の翻（通常 1、赤い糸で 2） */
  redHan: number;
  /** ドラと赤の翻を付けない（ボス「質素倹約」） */
  noBonus: boolean;
  /** 役なしでは和了れない（ボス「1翻縛り」） */
  shibari: boolean;
  noLimit: boolean;
}

export interface Win {
  evaluation: Evaluation;
  /** 和了に使った牌の id */
  tileIds: number[];
  /** 万能牌を当てはめたあとの種類 */
  kinds: Kind[];
  points: number;
}

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const acc: number[] = [];
  const rec = (start: number) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      acc.push(i);
      rec(i + 1);
      acc.pop();
    }
  };
  rec(0);
  return out;
}

/** 万能牌に当てはめる候補。3 枚以上のときは組み合わせが爆発するので、役になりそうな種類に絞る */
function jokerCandidates(fixed: readonly Kind[], jokers: number): Kind[] {
  if (jokers <= 2) return Array.from({ length: KIND_COUNT }, (_, k) => k);
  const s = new Set<Kind>([...DRAGONS, ...WINDS, ...ONES, ...NINES, ...GREEN]);
  for (const k of fixed) {
    for (const d of [-6, -3, -2, -1, 0, 1, 2, 3, 6]) {
      const x = k + d;
      if (x >= 0 && x < 27 && suit(x) === suit(k)) s.add(x);
    }
  }
  return [...s];
}

function bonusEntries(sub: readonly Tile[], kinds: readonly Kind[], ctx: WinContext): YakuEntry[] {
  const extra: YakuEntry[] = [];
  if (ctx.holdIds && !sub.some((t) => ctx.holdIds!.has(t.id))) extra.push(yakuEntry('門前', ctx.menzenHan));
  if (!ctx.noBonus) {
    const countDora = (list: readonly Kind[]) =>
      ctx.doraKinds.reduce((a, d) => a + list.filter((k) => k === d).length, 0);
    const dora =
      ctx.doraMode === 'normal' ? countDora(kinds) : ctx.doraMode === 'jokerPlus' ? countDora(sub.map((t) => t.kind)) : 0;
    if (dora) extra.push(yakuEntry('ドラ', dora));
    const red = sub.filter((t) => t.red).length;
    if (red) extra.push(yakuEntry('赤', red * ctx.redHan));
  }
  return extra;
}

export function bestWin(tiles: readonly Tile[], ctx: WinContext): Win | null {
  if (tiles.length < 5) return null;
  let best: Win | null = null;
  const sizes = tiles.length >= 6 ? [5, 6] : [5];
  for (const size of sizes) {
    for (const idx of combinations(tiles.length, size)) {
      const sub = idx.map((i) => tiles[i]);
      const fixed = sub.filter((t) => !ctx.isJoker(t.kind)).map((t) => t.kind);
      const jokers = size - fixed.length;
      const candidates = jokerCandidates(fixed, jokers);
      const rec = (kinds: Kind[], left: number) => {
        if (!left) {
          let ev = size === 5 ? evaluateFive(kinds, ctx.rules) : evaluateSix(kinds, ctx.rules);
          if (!ev || (ctx.shibari && ev.noYaku)) return;
          if (ctx.holdIds) ev = addHan(ev, bonusEntries(sub, kinds, ctx));
          const points = basePoints(ev, ctx.noLimit);
          if (!best || points > best.points) {
            best = { evaluation: ev, tileIds: sub.map((t) => t.id), kinds: kinds.slice(), points };
          }
          return;
        }
        for (const k of candidates) {
          if (kinds.filter((x) => x === k).length >= ctx.copies(k)) continue;
          kinds.push(k);
          rec(kinds, left - 1);
          kinds.pop();
        }
      };
      rec(fixed.slice(), jokers);
    }
  }
  return best;
}

/**
 * 待ち牌（あと 1 枚で和了れる種類）。万能牌が 2 枚以上あると計算が重く、ほぼ常に聴牌なので null を返す。
 */
export function waits(tiles: readonly Tile[], ctx: WinContext): Kind[] | null {
  if (tiles.filter((t) => ctx.isJoker(t.kind)).length >= 2) return null;
  const plain: WinContext = { ...ctx, holdIds: undefined };
  const out: Kind[] = [];
  for (let k = 0; k < KIND_COUNT; k++) {
    if (!ctx.copies(k)) continue;
    if (bestWin([...tiles, { id: -1, kind: k }], plain)) out.push(k);
  }
  return out;
}
