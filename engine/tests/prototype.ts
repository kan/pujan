/**
 * プロトタイプ（docs/prototype/puchi-mahjong.html）の判定ロジックを、そのまま Node で動かす。
 *
 * HTML の script から判定に関わる部分（evalHand・bestWin・finalize・judge など）だけを切り出し、
 * vm の別の文脈で実行する。プロトタイプは S（局）・G（場）・R（ラン）の大域変数を読むので、set() で与える。
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export interface ProtoTile {
  k: number;
  id: number;
  red?: boolean;
  gold?: boolean;
}

/** プロトタイプの和了。yaku は [名前, 表示値]（「2翻」「役満」など） */
export interface ProtoWin {
  pts: number;
  han?: number;
  noyaku?: boolean;
  label: string;
  yaku: [string, string][];
  ids: number[];
  kinds: number[];
}

export interface ProtoState {
  S: {
    jk: Set<number>;
    boss: string | null;
    doras: number[];
    bakaze: number;
    seat: number;
    riichi: boolean;
    riichiTurn: number;
    turn: number;
    discards: number;
    T: number;
    hand: ProtoTile[];
    drawn: ProtoTile[];
    hold: (ProtoTile | null)[];
  };
  G: { kyoku: number; oya: number; honba: number };
  R: { charms: string[]; equip: string[]; lv: Record<string, number>; comp: { count: number[] } };
}

export interface Prototype {
  set(state: ProtoState): void;
  evalHand(kinds: number[]): ProtoWin | null;
  evalSix(kinds: number[]): ProtoWin | null;
  bestWin(tiles: ProtoTile[], holdIds?: Set<number>): ProtoWin | null;
  waitsFor(tiles: ProtoTile[]): number[] | null;
  judge(): ProtoWin | null;
  finalize(w: ProtoWin): ProtoWin;
}

function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`prototype: "${start}" から "${end}" までが見つからない`);
  return src.slice(i, j);
}

export function loadPrototype(): Prototype {
  const html = readFileSync(new URL('../../docs/prototype/puchi-mahjong.html', import.meta.url), 'utf8');
  const code = [
    // 牌の定数、大域変数、has・eq・isJ・cap、点数表
    between(html, 'const DR=', '/* ---------- アイテム定義'),
    // 役判定・万能牌・和了探し・待ち
    between(html, 'function meldKind(', '/* ---------- 進行'),
    between(html, 'const nextKind=', '\n'),
    between(html, 'const isOya=', '\n'),
    between(html, 'function finalize(', '\nfunction startKyoku('),
    // allTiles・special・judge
    between(html, 'function allTiles(', '\nfunction draw('),
  ].join('\n');
  const api = runInNewContext(`(() => {
${code}
return {
  set(st) { S = st.S; G = st.G; R = st.R; },
  evalHand, evalSix, bestWin, waitsFor, judge, finalize,
};
})()`) as Prototype;
  // 別の文脈で作られた配列やオブジェクトを、こちらの文脈の値に直して返す
  const plain = <T>(v: T): T => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    set: (st) => api.set(st),
    evalHand: (k) => plain(api.evalHand(k)),
    evalSix: (k) => plain(api.evalSix(k)),
    bestWin: (t, h) => plain(api.bestWin(t, h)),
    waitsFor: (t) => plain(api.waitsFor(t)),
    judge: () => plain(api.judge()),
    finalize: (w) => plain(api.finalize(w)),
  };
}
