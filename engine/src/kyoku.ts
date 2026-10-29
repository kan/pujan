/**
 * 1 局の進行。仕様は docs/SPEC.md §3.2「局の流れ」。
 *
 * 状態は書き換えず、step() が新しい状態を返す。乱数の状態も KyokuState に入っているので、
 * 同じ初期状態に同じ操作を順に与えれば同じ結果になる（操作ログの再生）。
 */
import { addHan, addYakuman, yakuEntry, type YakuEntry } from './hand.js';
import { CONSUMABLES, EXTEND_TURNS, SOME_COLORS, type ConsumableId, type Modifiers } from './items.js';
import { shuffle } from './rng.js';
import { basePoints, finalizeScore, type FinalizeContext, type FinalScore } from './score.js';
import { HAKU, KIND_COUNT, byKind, doraOf, suit, type Kind, type Tile } from './tiles.js';
import { bestWin, waits, type Win, type WinContext } from './win.js';

/** 牌山の構成。牌の改造（朱塗り・金箔・抜き取り・写し）で変わり、ランの間ずっと残る */
export interface Composition {
  /** 種類ごとの枚数（0〜5） */
  count: number[];
  /** 種類ごとの赤牌の枚数 */
  red: number[];
  /** 種類ごとの金牌の枚数 */
  gold: number[];
}

export function defaultComposition(redFives: boolean): Composition {
  const red = Array<number>(KIND_COUNT).fill(0);
  if (redFives) for (const k of [4, 13, 22]) red[k] = 1;
  return { count: Array<number>(KIND_COUNT).fill(4), red, gold: Array<number>(KIND_COUNT).fill(0) };
}

export interface KyokuSetup {
  rng: number;
  composition: Composition;
  mods: Modifiers;
  /** 場風 */
  bakaze: Kind;
  /** 自風 */
  seat: Kind;
  dealer: boolean;
  honba: number;
  yakuLevels: Readonly<Record<string, number>>;
}

export type Zone = 'hand' | 'drawn' | 'hold';

export type KyokuAction =
  | { type: 'discard'; zone: Zone; index: number }
  | { type: 'hold'; zone: 'hand' | 'drawn'; index: number; slot?: number }
  | { type: 'riichi'; zone: Zone; index: number }
  | { type: 'tsumo' }
  | { type: 'redeal' }
  /** 消耗品を使う。染め粉は残す色（color: 0 萬子・1 筒子・2 索子・3 字牌）が要る */
  | { type: 'consumable'; id: ConsumableId; color?: number };

/** 消耗品を除いた局の操作（消耗品は持ち物から外す必要があるので、ランの側で扱う） */
export type KyokuMove = Exclude<KyokuAction, { type: 'consumable' }>;

export type KyokuResult =
  | {
      type: 'win';
      win: Win;
      score: FinalScore;
      /** 裏ドラ表示牌（リーチしていなければ空） */
      ura: Tile[];
      /** 和了に使った金牌の枚数 */
      gold: number;
    }
  | {
      type: 'draw';
      tenpai: boolean;
      /** 聴牌料 */
      fee: number;
      /** 親のノーテン罰符 */
      penalty: number;
      /** 没収されたリーチ棒 */
      stickLost: number;
    };

export interface KyokuState {
  rng: number;
  wall: Tile[];
  hand: Tile[];
  drawn: Tile[];
  hold: (Tile | null)[];
  river: Tile[];
  indicators: Tile[];
  doraKinds: Kind[];
  jokerKinds: Kind[];
  turn: number;
  discards: number;
  redealt: boolean;
  riichi: { turn: number; stick: number } | null;
  /** 山覗きを使った */
  peek: boolean;
  /** 延長札で延びた巡の数（1 局の巡数は turnLimit で引く） */
  extraTurns: number;
  /** 染め粉で山から抜いた牌（待ちの残り枚数で、見えた牌と同じく数から引く） */
  removed: Tile[];
  /** 直前の打牌のあとの待ち（null は計算を省いた聴牌） */
  waits: Kind[] | null;
  /** 今のツモで和了れる手（和了れなければ null） */
  win: Win | null;
  result: KyokuResult | null;
  setup: Omit<KyokuSetup, 'rng' | 'composition'> & { copies: number[] };
}

function buildWall(rng: number, comp: Composition): [number, Tile[]] {
  const tiles: Tile[] = [];
  let id = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const n = comp.count[k];
    const red = comp.red[k];
    const gold = comp.gold[k];
    for (let i = 0; i < n; i++) tiles.push({ id: id++, kind: k, red: i < red, gold: i >= red && i < red + gold });
  }
  return shuffle(rng, tiles);
}

/** 山の並びの指定（チュートリアル用）。指定した牌を山から抜き、この順で引かれるように山の端に並べる */
export interface WallOrder {
  /** ドラ表示牌 */
  indicators: readonly Kind[];
  /** 配牌（4 枚） */
  hand: readonly Kind[];
  /** ツモの順（1 巡目から） */
  draws: readonly Kind[];
}

function arrangeWall(wall: Tile[], order: WallOrder): Tile[] {
  const rest = wall.slice();
  // 赤牌・金牌でない牌を優先して抜く（絵柄を説明どおりにするため）
  const take = (k: Kind): Tile => {
    const i = rest.findIndex((t) => t.kind === k && !t.red && !t.gold);
    const j = i >= 0 ? i : rest.findIndex((t) => t.kind === k);
    if (j < 0) throw new Error(`no ${k} left in the wall`);
    return rest.splice(j, 1)[0];
  };
  const indicators = order.indicators.map(take);
  const hand = order.hand.map(take);
  const draws = order.draws.map(take);
  // 山は末尾から引く: ドラ表示（pop）→ 配牌（末尾 4 枚）→ ツモ（pop）
  return [...rest, ...draws.reverse(), ...hand, ...indicators.reverse()];
}

/** 局を始める。order を渡すと、山の並びをその通りにする（チュートリアル用。ふつうのランでは渡さない） */
export function startKyoku(setup: KyokuSetup, order?: WallOrder): KyokuState {
  let [rng, wall] = buildWall(setup.rng, setup.composition);
  if (order) wall = arrangeWall(wall, order);
  const indicators: Tile[] = [];
  for (let i = 0; i < setup.mods.doraIndicators; i++) indicators.push(wall.pop()!);
  const doraKinds = indicators.map((t) => doraOf(t.kind));
  const hand = wall.splice(-4).sort(byKind);
  const { rng: _rng, composition, ...rest } = setup;
  void _rng;
  const state: KyokuState = {
    rng,
    wall,
    hand,
    drawn: [],
    hold: Array(setup.mods.holdSlots).fill(null),
    river: [],
    indicators,
    doraKinds,
    jokerKinds: setup.mods.doraMode === 'normal' ? [] : doraKinds,
    turn: 0,
    discards: 0,
    redealt: false,
    riichi: null,
    peek: false,
    extraTurns: 0,
    removed: [],
    waits: [],
    win: null,
    result: null,
    setup: { ...rest, copies: composition.count.slice() },
  };
  return drawNext(state);
}

/**
 * この局の巡数（持ち物とボスで決まる巡数に、延長札の分を足したもの）。
 * 局の巡数はここから読む（setup.mods.turns には延長札の分が入らない）
 */
export function turnLimit(s: KyokuState): number {
  return s.setup.mods.turns + s.extraTurns;
}

export function allTiles(s: KyokuState): Tile[] {
  return [...s.hand, ...s.drawn, ...(s.hold.filter(Boolean) as Tile[])];
}

export function isJoker(s: KyokuState, k: Kind): boolean {
  return s.jokerKinds.includes(k) || (s.setup.mods.hakuJoker && k === HAKU);
}

export function winContext(s: KyokuState, withBonus: boolean): WinContext {
  const m = s.setup.mods;
  return {
    rules: {
      bakaze: s.setup.bakaze,
      seat: s.setup.seat,
      sameColorManSou: m.sameColorManSou,
      skipSequences: m.skipSequences,
      allWindsYakuhai: m.allWindsYakuhai,
      wrapSequences: m.wrapSequences,
    },
    isJoker: (k) => isJoker(s, k),
    copies: (k) => s.setup.copies[k],
    holdIds: withBonus ? new Set((s.hold.filter(Boolean) as Tile[]).map((t) => t.id)) : undefined,
    doraKinds: s.doraKinds,
    doraMode: m.doraMode,
    menzenHan: m.menzenHan,
    redHan: m.redHan,
    noBonus: m.noBonus,
    shibari: m.shibari,
    noLimit: m.noLimit,
  };
}

/** 今のツモで和了れる手。局の状況で決まる翻（リーチ・海底・天和など）もここで足す */
export function judge(s: KyokuState): Win | null {
  const w = bestWin(allTiles(s), winContext(s, true));
  if (!w) return null;
  const m = s.setup.mods;
  const extra: YakuEntry[] = [];
  if (s.riichi) extra.push(yakuEntry('リーチ', m.riichiHan));
  if (s.riichi && m.ippatsuHan && s.turn === s.riichi.turn + 1) extra.push(yakuEntry('一発屋', m.ippatsuHan));
  if (m.earlyWinBonus && s.turn <= 6) extra.push(yakuEntry('早指し', 1));
  if (m.haitei && s.turn === turnLimit(s)) extra.push(yakuEntry('海底', 1));
  let ev = addHan(w.evaluation, extra);
  if (s.turn === 1) ev = addYakuman(ev, '天和');
  else if (s.turn === 2 && s.discards === 0) ev = addYakuman(ev, '地和');
  return { ...w, evaluation: ev, points: basePoints(ev, m.noLimit) };
}

/** 親のノーテン流局の罰符: 300 点×（本場数＋1） */
export const notenPenalty = (honba: number): number => 300 * (honba + 1);

function endWithDraw(s: KyokuState): KyokuState {
  const tenpai = s.waits === null || s.waits.length > 0;
  const fee = tenpai ? s.setup.mods.tenpaiFee : 0;
  const penalty = s.setup.dealer && !tenpai ? notenPenalty(s.setup.honba) : 0;
  return {
    ...s,
    drawn: [],
    win: null,
    result: { type: 'draw', tenpai, fee, penalty, stickLost: s.setup.mods.riichiStickBack ? 0 : (s.riichi?.stick ?? 0) },
  };
}

function drawNext(s: KyokuState): KyokuState {
  if (s.turn >= turnLimit(s) || !s.wall.length) return endWithDraw(s);
  const wall = s.wall.slice();
  const tile = wall.pop()!;
  const next: KyokuState = { ...s, wall, turn: s.turn + 1, drawn: [tile] };
  return { ...next, win: judge(next) };
}

/** 打牌や保留のあと。ツモ牌が残っていればもう一度選ばせ、なくなれば待ちを計算して次をツモる */
function afterAction(s: KyokuState): KyokuState {
  const hand = s.hand.slice();
  const drawn = s.drawn.slice();
  while (hand.length < 4 && drawn.length) hand.push(drawn.shift()!);
  hand.sort(byKind);
  let next: KyokuState = { ...s, hand, drawn };
  if (drawn.length) return { ...next, win: judge(next) };
  next = { ...next, win: null, waits: waits([...hand, ...(s.hold.filter(Boolean) as Tile[])], winContext(next, false)) };
  if (next.turn >= turnLimit(next)) return endWithDraw(next);
  return drawNext(next);
}

function tileAt(s: KyokuState, zone: Zone, index: number): Tile {
  const list = zone === 'hand' ? s.hand : zone === 'drawn' ? s.drawn : zone === 'hold' ? s.hold : null;
  const t = list && Number.isInteger(index) ? list[index] : undefined;
  if (!t) throw new Error(`no tile at ${zone}[${index}]`);
  return t;
}

/** 牌を 1 枚手放す。保留牌を捨てたときは、空いた枠にツモ牌が入る */
function removeTile(s: KyokuState, zone: Zone, index: number): [KyokuState, Tile] {
  const t = tileAt(s, zone, index);
  if (zone === 'hand') return [{ ...s, hand: s.hand.filter((_, i) => i !== index) }, t];
  if (zone === 'drawn') return [{ ...s, drawn: s.drawn.filter((_, i) => i !== index) }, t];
  const hold = s.hold.slice();
  const drawn = s.drawn.slice();
  hold[index] = drawn.shift() ?? null;
  return [{ ...s, hold, drawn }, t];
}

export function isActing(s: KyokuState): boolean {
  return !s.result && s.drawn.length > 0;
}

export function canRedeal(s: KyokuState): boolean {
  return isActing(s) && s.turn === 1 && s.discards === 0 && !s.redealt && !s.hold.some(Boolean);
}

/** その牌を捨ててリーチできるか（捨てたあとに聴牌しているか） */
export function canRiichi(s: KyokuState, zone: Zone, index: number): boolean {
  if (!isActing(s) || s.riichi) return false;
  const t = tileAt(s, zone, index);
  const rest = allTiles(s).filter((x) => x !== t);
  const w = waits(rest, winContext(s, false));
  return w === null || w.length > 0;
}

export function canUseConsumable(s: KyokuState, id: ConsumableId): boolean {
  if (!isActing(s)) return false;
  if (s.riichi && !CONSUMABLES.find((c) => c.id === id)?.usableInRiichi) return false;
  // 延長札は最終巡のツモのあと、打牌の前だけ（1 局に 1 回）。山が尽きていれば延ばしても引けない
  if (id === 'encho') return s.turn === turnLimit(s) && s.extraTurns === 0 && s.wall.length > 0;
  if (id === 'hiroi') return s.river.length > 0;
  if (id === 'nozoki') return !s.peek;
  return true;
}

/** ネクストに見える牌（左が次のツモ） */
export function visibleNext(s: KyokuState): Tile[] {
  if (s.riichi) return [];
  const n = s.peek ? 5 : s.setup.mods.next;
  return n ? s.wall.slice(-n).reverse() : [];
}

function discard(s: KyokuState, zone: Zone, index: number): KyokuState {
  const [next, t] = removeTile(s, zone, index);
  return afterAction({ ...next, river: [...s.river, t], discards: s.discards + 1 });
}

export function step(s: KyokuState, action: KyokuAction): KyokuState {
  if (s.result) throw new Error('kyoku has ended');
  if (!isActing(s)) throw new Error('not waiting for an action');
  switch (action.type) {
    case 'discard':
      if (s.riichi && action.zone !== 'drawn') throw new Error('riichi: only the drawn tile can be discarded');
      return discard(s, action.zone, action.index);
    case 'hold': {
      if (s.riichi) throw new Error('riichi: cannot hold');
      // 操作ログは信頼できない入力なので、枠の番号と置き場所もここで確かめる
      if (action.zone !== 'hand' && action.zone !== 'drawn') throw new Error('can hold only from hand or drawn');
      const slot = action.slot ?? s.hold.indexOf(null);
      if (!Number.isInteger(slot) || slot < 0 || slot >= s.hold.length || s.hold[slot]) throw new Error('no empty hold slot');
      const [next, t] = removeTile(s, action.zone, action.index);
      const hold = next.hold.slice();
      hold[slot] = t;
      return afterAction({ ...next, hold });
    }
    case 'riichi': {
      if (!canRiichi(s, action.zone, action.index)) throw new Error('cannot riichi');
      // 宣言の打牌はどの牌でもよい（ツモ切りに縛られるのは次の巡から）
      const declared: KyokuState = { ...s, riichi: { turn: s.turn, stick: s.setup.mods.riichiCost } };
      return discard(declared, action.zone, action.index);
    }
    case 'redeal': {
      if (!canRedeal(s)) throw new Error('cannot redeal');
      const [rng, wall] = shuffle(s.rng, [...s.wall, ...s.hand, ...s.drawn]);
      const hand = wall.splice(-4).sort(byKind);
      const drawn = [wall.pop()!];
      const next: KyokuState = { ...s, rng, wall, hand, drawn, redealt: true };
      return { ...next, win: judge(next) };
    }
    case 'consumable':
      return useConsumable(s, action.id, action.color);
    case 'tsumo':
      return declareWin(s);
    default:
      throw new Error(`unknown action: ${(action as { type: unknown }).type}`);
  }
}

/** 染め粉: 残す色以外の牌を、山から半分（端数は切り捨て）抜く。抜く牌は局の乱数で選び、山の並びは保つ */
function dye(s: KyokuState, color: number): KyokuState {
  const others = s.wall.flatMap((t, i) => (suit(t.kind) === color ? [] : [i]));
  const [rng, shuffled] = shuffle(s.rng, others);
  const drop = new Set(shuffled.slice(0, Math.floor(others.length / 2)));
  return {
    ...s,
    rng,
    wall: s.wall.filter((_, i) => !drop.has(i)),
    removed: [...s.removed, ...s.wall.filter((_, i) => drop.has(i))],
  };
}

function useConsumable(s: KyokuState, id: ConsumableId, color?: number): KyokuState {
  if (!canUseConsumable(s, id)) throw new Error(`cannot use ${id}`);
  // 操作ログは信頼できない入力なので、色を取らない消耗品に色が付いていたら拒む
  if (id !== 'some' && color !== undefined) throw new Error(`${id} takes no color`);
  let next: KyokuState;
  if (id === 'some') {
    // 操作ログは信頼できない入力なので、色の番号もここで確かめる
    if (color === undefined || !Number.isInteger(color) || color < 0 || color >= SOME_COLORS.length) {
      throw new Error('invalid color');
    }
    next = dye(s, color);
  } else if (id === 'encho') {
    next = { ...s, extraTurns: EXTEND_TURNS };
  } else if (id === 'tsumo') {
    const wall = s.wall.slice();
    const [old, ...restDrawn] = s.drawn;
    wall.unshift(old);
    next = { ...s, wall, drawn: [wall.pop()!, ...restDrawn] };
  } else if (id === 'hiroi') {
    const river = s.river.slice();
    next = { ...s, river, drawn: [...s.drawn, river.pop()!] };
  } else if (id === 'nozoki') {
    next = { ...s, peek: true };
  } else {
    const [rng, wall] = shuffle(s.rng, [...s.wall, ...s.hand, ...s.drawn]);
    const hand = wall.splice(-4).sort(byKind);
    next = { ...s, rng, wall, hand, drawn: [wall.pop()!] };
  }
  return { ...next, win: judge(next) };
}

/** 和了の点数を決める、局と持ち物の情報 */
export function finalizeContext(s: KyokuState): FinalizeContext {
  const m = s.setup.mods;
  return {
    noLimit: m.noLimit,
    yakuLevels: s.setup.yakuLevels,
    cheapHandTimes4: m.cheapHandTimes4,
    dealer: s.setup.dealer,
    dealerMultiplier: m.dealerMultiplier,
    riichiTurns: s.riichi ? s.turn - s.riichi.turn : 0,
    riichiBonusPerTurn: m.riichiBonusPerTurn,
    honba: s.setup.honba,
    honbaBonus: m.honbaBonus,
  };
}

function declareWin(s: KyokuState): KyokuState {
  if (!s.win) throw new Error('no winning hand');
  let ev = s.win.evaluation;
  let ura: Tile[] = [];
  if (s.riichi) {
    ura = s.wall.slice(0, s.setup.mods.uraIndicators);
    const n = ura.reduce((a, t) => a + s.win!.kinds.filter((k) => k === doraOf(t.kind)).length, 0);
    if (n) ev = addHan(ev, [yakuEntry('裏ドラ', n)]);
  }
  const score = finalizeScore(ev, finalizeContext(s));
  const used = new Set(s.win.tileIds);
  const gold = allTiles(s).filter((t) => used.has(t.id) && t.gold).length;
  const win = { ...s.win, evaluation: ev, points: score.points };
  return { ...s, result: { type: 'win', win, score, ura, gold } };
}

/** 待ち牌の残り枚数（見えている牌から数える） */
export function remainingOf(s: KyokuState, k: Kind): number {
  const seen = [...allTiles(s), ...s.river, ...s.indicators, ...s.removed].filter((t) => t.kind === k).length;
  return Math.max(0, s.setup.copies[k] - seen);
}
