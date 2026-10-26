/**
 * シード付きの擬似乱数（xorshift32）。vegtab の engine と同じ形。
 *
 * 状態は 32bit 整数で、関数はすべて [次の状態, 値] を返す。
 * 山の並びとショップの品揃えをシードから決めることで、
 * デイリーランと、サーバーでの操作ログの再生（不正の検証）ができる。
 */

export function createRng(seed: number): number {
  return seed === 0 ? 1 : (seed | 0) || 1;
}

export function nextRng(state: number): [number, number] {
  let s = state;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  s = s | 0;
  if (s === 0) s = 1;
  return [s, s];
}

/** 0 以上 max 未満の整数 */
export function nextInt(state: number, max: number): [number, number] {
  const [next, raw] = nextRng(state);
  return [next, (raw >>> 0) % max];
}

/** 0 以上 1 未満の数 */
export function nextFloat(state: number): [number, number] {
  const [next, raw] = nextRng(state);
  return [next, (raw >>> 0) / 0x100000000];
}

/** 配列を Fisher–Yates で並べ替えた新しい配列を返す */
export function shuffle<T>(state: number, items: readonly T[]): [number, T[]] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let j: number;
    [s, j] = nextInt(s, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [s, out];
}

/**
 * 32bit の avalanche ハッシュ。ある状態から別の乱数列を派生させるときに挟む
 * （同じ状態をそのまま種にすると、1 ステップずれただけの同じ列になる）。
 */
export function mix32(x: number): number {
  let h = x >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h | 0;
}
