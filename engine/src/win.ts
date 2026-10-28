/**
 * 手元の牌（手牌・ツモ牌・保留牌）から、いちばん点の高い和了を探す。
 *
 * 5 枚の組み合わせと（6 枚以上あれば）三対子の 6 枚を全部試し、万能牌は取りうる種類を全部当てはめる。
 * ボーナスの翻（門前・ドラ・赤）は組み合わせごとに変わるので、ここで足してから比べる。
 */
import { addHan, evaluateFive, evaluateSix, yakuEntry, type Evaluation, type HandRules, type YakuEntry } from './hand.js';
import { basePoints } from './score.js';
import { ALL_KINDS, DRAGONS, GREEN, KIND_COUNT, NINES, ONES, WINDS, suit, type Kind, type Tile } from './tiles.js';

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
  /** 和了に使った万能牌の id と、当てはめた種類（画面で「何の牌として扱ったか」を示すため） */
  jokers: { id: number; kind: Kind }[];
  points: number;
}

const comboCache = new Map<string, number[][]>();

/**
 * 0〜n-1 から k 個を選ぶ組み合わせ（番号の昇順）。withLast なら 0〜n-1 から k-1 個を選び、最後に n を足す
 * （待ちの計算で、足した 1 枚を必ず含む組）。同じ引数は何度も使うので覚えておく。
 */
function combinations(n: number, k: number, withLast = false): number[][] {
  const key = `${n},${k},${withLast}`;
  const hit = comboCache.get(key);
  if (hit) return hit;
  const out = withLast ? combinations(n, k - 1).map((idx) => [...idx, n]) : makeCombinations(n, k);
  comboCache.set(key, out);
  return out;
}

function makeCombinations(n: number, k: number): number[][] {
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
function jokerCandidates(fixed: readonly Kind[], jokers: number): readonly Kind[] {
  if (jokers <= 2) return ALL_KINDS;
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

/**
 * 和了形になる組（5 枚、6 枚以上あれば三対子の 6 枚も）を順に訪ねる。visit が true を返すと打ち切る。
 * must を渡すと、その牌を含む組だけを訪ねる（待ちの計算で、足した 1 枚を含む組だけを見るため）。
 * 訪ねる順は、組み合わせの番号順・万能牌の候補順で決まっている（いちばん高い手が同点のときの選び方が変わらないように）。
 */
function forEachWin(
  tiles: readonly Tile[],
  ctx: WinContext,
  /** kinds は、万能牌でない牌の種類を sub の順に並べ、その後ろに jokerTiles の順で当てはめた種類を足したもの */
  visit: (ev: Evaluation, sub: readonly Tile[], kinds: readonly Kind[], jokerTiles: readonly Tile[]) => boolean | void,
  must?: Tile,
): void {
  const all = must ? [...tiles, must] : tiles;
  if (all.length < 5) return;
  const sizes = all.length >= 6 ? [5, 6] : [5];
  for (const size of sizes) {
    const combos = must ? combinations(tiles.length, size, true) : combinations(all.length, size);
    for (const idx of combos) {
      const sub = idx.map((i) => all[i]);
      const fixed = sub.filter((t) => !ctx.isJoker(t.kind)).map((t) => t.kind);
      const jokerTiles = sub.filter((t) => ctx.isJoker(t.kind));
      const jokers = jokerTiles.length;
      const candidates = jokers ? jokerCandidates(fixed, jokers) : ALL_KINDS;
      let stop = false;
      const rec = (kinds: Kind[], left: number) => {
        if (!left) {
          const ev = size === 5 ? evaluateFive(kinds, ctx.rules) : evaluateSix(kinds, ctx.rules);
          if (ev && !(ctx.shibari && ev.noYaku) && visit(ev, sub, kinds, jokerTiles)) stop = true;
          return;
        }
        for (const k of candidates) {
          if (kinds.filter((x) => x === k).length >= ctx.copies(k)) continue;
          kinds.push(k);
          rec(kinds, left - 1);
          kinds.pop();
          if (stop) return;
        }
      };
      rec(fixed.slice(), jokers);
      if (stop) return;
    }
  }
}

export function bestWin(tiles: readonly Tile[], ctx: WinContext): Win | null {
  let best: Win | null = null;
  forEachWin(tiles, ctx, (found, sub, kinds, jokerTiles) => {
    const ev = ctx.holdIds ? addHan(found, bonusEntries(sub, kinds, ctx)) : found;
    const points = basePoints(ev, ctx.noLimit);
    if (!best || points > best.points) {
      const offset = kinds.length - jokerTiles.length;
      const jokers = jokerTiles.map((t, j) => ({ id: t.id, kind: kinds[offset + j] }));
      best = { evaluation: ev, tileIds: sub.map((t) => t.id), kinds: kinds.slice(), jokers, points };
    }
  });
  return best;
}

/** 和了形が 1 つでもあるか（must を渡すと、その牌を含む組だけを見る） */
function hasWin(tiles: readonly Tile[], ctx: WinContext, must?: Tile): boolean {
  let found = false;
  forEachWin(tiles, ctx, () => (found = true), must);
  return found;
}

/**
 * 待ち牌（あと 1 枚で和了れる種類）。万能牌が 2 枚以上あると計算が重く、ほぼ常に聴牌なので null を返す。
 * 手元の牌だけでもう和了形があるなら、山にあるどの種類でも和了れる。
 */
export function waits(tiles: readonly Tile[], ctx: WinContext): Kind[] | null {
  if (tiles.filter((t) => ctx.isJoker(t.kind)).length >= 2) return null;
  const out: Kind[] = [];
  const already = hasWin(tiles, ctx);
  for (let k = 0; k < KIND_COUNT; k++) {
    if (!ctx.copies(k)) continue;
    if (already || hasWin(tiles, ctx, { id: -1, kind: k })) out.push(k);
  }
  return out;
}
