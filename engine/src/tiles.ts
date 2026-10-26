/**
 * 牌の種類と基本の判定。
 *
 * 種類（Kind）は 0〜33 の整数で表す。
 * - 0〜8: 萬子の 1〜9、9〜17: 筒子の 1〜9、18〜26: 索子の 1〜9
 * - 27〜30: 東南西北、31〜33: 白發中
 */

export type Kind = number;

export const KIND_COUNT = 34;

export const EAST = 27;
export const SOUTH = 28;
export const WEST = 29;
export const NORTH = 30;
export const HAKU = 31;
export const HATSU = 32;
export const CHUN = 33;

export const WINDS: readonly Kind[] = [EAST, SOUTH, WEST, NORTH];
export const DRAGONS: readonly Kind[] = [HAKU, HATSU, CHUN];
export const ONES: readonly Kind[] = [0, 9, 18];
export const NINES: readonly Kind[] = [8, 17, 26];
/** 緑一色に使える牌（2・3・4・6・8索と發） */
export const GREEN: ReadonlySet<Kind> = new Set([19, 20, 21, 23, 25, HATSU]);
/** 初期の山で赤牌になる牌（各色の 5） */
export const RED_FIVES: readonly Kind[] = [4, 13, 22];

/** 1 枚の牌。id は局の中で一意 */
export interface Tile {
  id: number;
  kind: Kind;
  red?: boolean;
  gold?: boolean;
}

/** 0: 萬子、1: 筒子、2: 索子、3: 字牌 */
export function suit(k: Kind): number {
  return k < 27 ? Math.floor(k / 9) : 3;
}

/** 数牌の数字から 1 を引いた値（0〜8）。字牌では意味を持たない */
export function num(k: Kind): number {
  return k % 9;
}

export function isHonor(k: Kind): boolean {
  return k >= 27;
}

/** 么九牌（1・9・字牌） */
export function isYaochu(k: Kind): boolean {
  return k >= 27 || k % 9 === 0 || k % 9 === 8;
}

const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
const SUIT_NAMES = ['萬', '筒', '索'];

export function tileName(k: Kind): string {
  return k < 27 ? `${num(k) + 1}${SUIT_NAMES[suit(k)]}` : HONOR_NAMES[k - 27];
}

/** ドラ表示牌からドラの種類を求める（数牌は 9 の次が 1、風牌は東南西北、三元牌は白發中で巡る） */
export function doraOf(indicator: Kind): Kind {
  if (indicator < 27) return Math.floor(indicator / 9) * 9 + ((num(indicator) + 1) % 9);
  if (indicator < 31) return 27 + ((indicator - 27 + 1) % 4);
  return 31 + ((indicator - 31 + 1) % 3);
}

export function byKind(a: Tile, b: Tile): number {
  return a.kind - b.kind || a.id - b.id;
}
