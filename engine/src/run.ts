/**
 * ローグライトのラン。仕様は docs/SPEC.md §4「ローグライト」。
 *
 * 東南西北の 4 場（1 場 4 局）を勝ち抜けばクリア。局の合間にショップが開く。
 * 局そのものは kyoku.ts が進め、ここは局の結果の精算・場の進行・ショップを受け持つ。
 */
import {
  BOSSES,
  CHARMS,
  CONSUMABLES,
  DEFAULT_BASE_RULES,
  EQUIPMENT,
  MAX_CHARMS,
  MAX_CONSUMABLES,
  MODS,
  PRICES,
  REROLL_PRICE,
  SCROLL_YAKU,
  SELL_PRICE,
  modifiersFor,
  type BaseRules,
  type BossId,
  type CharmId,
  type ConsumableId,
  type EquipId,
  type Loadout,
  type ModId,
} from './items.js';
import { defaultComposition, startKyoku, type Composition, type KyokuResult, type KyokuState } from './kyoku.js';
import { createRng, mix32, nextFloat, nextInt } from './rng.js';
import { EAST, KIND_COUNT, type Kind } from './tiles.js';

export const WAVE_TARGETS: readonly number[] = [1000, 2000, 4000, 8000];
export const WAVE_COUNT = 4;
export const KYOKU_PER_WAVE = 4;
export const START_MONEY = 4;

export interface RoundLogEntry {
  kyoku: number;
  honba: number;
  /** 役の並び、または「流局（聴牌）」など */
  label: string;
  points: number;
  dealer: boolean;
}

/** 1 場（東場・南場…）の状態 */
export interface Round {
  /** 0〜3（東1局〜東4局） */
  kyoku: number;
  score: number;
  /** 親番の局（0〜3） */
  dealer: number;
  honba: number;
  /** オーラス（4 局目）のボス */
  boss: BossId;
  target: number;
  log: RoundLogEntry[];
}

export type Offer =
  | { kind: 'charm'; id: CharmId; price: number; sold: boolean }
  | { kind: 'equip'; id: EquipId; price: number; sold: boolean }
  | { kind: 'consumable'; id: ConsumableId; price: number; sold: boolean }
  | { kind: 'mod'; id: ModId; price: number; sold: boolean }
  | { kind: 'scroll'; yaku: string; price: number; sold: boolean };

/** 場の突破で受け取った祝儀の内訳 */
export interface WaveBonus {
  clear: number;
  interest: number;
  over: number;
}

export type RunPhase = 'kyoku' | 'shop' | 'over' | 'cleared';
/** ショップを出たあとに進む先 */
export type AfterShop = 'sameKyoku' | 'nextKyoku' | 'nextWave';

export interface RunState {
  seed: number;
  rng: number;
  base: BaseRules;
  /** 0〜3（東・南・西・北） */
  wave: number;
  money: number;
  charms: CharmId[];
  equipment: EquipId[];
  consumables: ConsumableId[];
  yakuLevels: Record<string, number>;
  composition: Composition;
  round: Round;
  phase: RunPhase;
  shop: Offer[] | null;
  afterShop: AfterShop | null;
  /** 直前に突破した場の祝儀（ショップの前に表示する） */
  lastWaveBonus: WaveBonus | null;
}

function newRound(rng: number, wave: number): [number, Round] {
  let r = rng;
  let dealer: number;
  let boss: number;
  [r, dealer] = nextInt(r, KYOKU_PER_WAVE);
  [r, boss] = nextInt(r, BOSSES.length);
  return [r, { kyoku: 0, score: 0, dealer, honba: 0, boss: BOSSES[boss].id, target: WAVE_TARGETS[wave], log: [] }];
}

/**
 * 新しいラン。start は最初から持つお守りと設備（今はシミュレーションだけが使う。
 * 雀士などで画面から使うときは、操作ログにも残して再生できるようにする）。
 */
export function createRun(seed: number, base: BaseRules = DEFAULT_BASE_RULES, start?: Loadout): RunState {
  const [rng, round] = newRound(createRng(mix32(seed)), 0);
  return {
    seed,
    rng,
    base,
    wave: 0,
    money: START_MONEY,
    charms: [...(start?.charms ?? [])],
    equipment: [...(start?.equipment ?? [])],
    consumables: [],
    yakuLevels: {},
    composition: defaultComposition(base.redFives),
    round,
    phase: 'kyoku',
    shop: null,
    afterShop: null,
    lastWaveBonus: null,
  };
}

export const bakazeOf = (run: RunState): Kind => EAST + run.wave;
export const isDealerKyoku = (run: RunState): boolean => run.round.kyoku === run.round.dealer;
/** 自風: 親の局は東、そこから逆算して南・西・北 */
export const seatOf = (run: RunState): Kind => EAST + ((((run.round.dealer - run.round.kyoku) % 4) + 4) % 4);
export const bossOf = (run: RunState): BossId | null => (run.round.kyoku === KYOKU_PER_WAVE - 1 ? run.round.boss : null);

/** 今の局を始める。局の乱数はランの乱数から派生させる */
export function beginKyoku(run: RunState): { run: RunState; kyoku: KyokuState } {
  if (run.phase !== 'kyoku') throw new Error('not in a kyoku');
  const [rng, raw] = nextInt(run.rng, 0x7fffffff);
  const kyoku = startKyoku({
    rng: createRng(mix32(raw)),
    composition: run.composition,
    mods: modifiersFor(run.base, { charms: run.charms, equipment: run.equipment }, bossOf(run)),
    bakaze: bakazeOf(run),
    seat: seatOf(run),
    dealer: isDealerKyoku(run),
    honba: run.round.honba,
    yakuLevels: run.yakuLevels,
  });
  return { run: { ...run, rng }, kyoku };
}

/** 和了の祝儀: 2＋翻数の半分（最大 6）、役満は 6、金牌 1 枚につき＋2 */
export function moneyForWin(result: Extract<KyokuResult, { type: 'win' }>): number {
  const ev = result.win.evaluation;
  const base = ev.yakuman ? 6 : 2 + Math.min(4, Math.floor(ev.han / 2));
  return base + result.gold * 2;
}

/** 局の点数の増減（リーチ棒は宣言時ではなく精算時に引く） */
export function pointsDelta(result: KyokuResult): number {
  return result.type === 'win' ? result.score.points : result.fee - result.penalty - result.stickLost;
}

/**
 * 局の結果を精算する。親の和了では renchan で連荘か和了やめかを選ぶ。
 * 4 局目のあとは場の判定に進み、それ以外はショップを開く。
 */
export function settleKyoku(run: RunState, result: KyokuResult, renchan = false): RunState {
  const dealer = isDealerKyoku(run);
  const round: Round = { ...run.round, score: run.round.score + pointsDelta(result), log: run.round.log.slice() };
  let money = run.money;
  if (result.type === 'win') {
    money += moneyForWin(result);
    round.log.push({
      kyoku: round.kyoku,
      honba: round.honba,
      label: result.win.evaluation.yaku.map((y) => y.name).join('・') || '役なし',
      points: result.score.points,
      dealer,
    });
  } else {
    if (result.tenpai) money += 1;
    round.log.push({
      kyoku: round.kyoku,
      honba: round.honba,
      label: result.tenpai ? '流局（聴牌）' : '流局',
      points: pointsDelta(result),
      dealer,
    });
  }
  const next: RunState = { ...run, money, round };
  if (result.type === 'win' && dealer && renchan) {
    next.round = { ...round, honba: round.honba + 1 };
    return openShop(next, 'sameKyoku');
  }
  next.round = { ...round, honba: 0 };
  if (round.kyoku >= KYOKU_PER_WAVE - 1) return endWave(next);
  return openShop(next, 'nextKyoku');
}

function endWave(run: RunState): RunState {
  const { score, target } = run.round;
  if (score < target) return { ...run, phase: 'over', shop: null, afterShop: null };
  const bonus: WaveBonus = {
    clear: 3,
    interest: Math.min(5, Math.floor(run.money / 5)),
    over: Math.max(0, Math.min(3, Math.floor((score / target - 1) / 0.5))),
  };
  const next = { ...run, money: run.money + bonus.clear + bonus.interest + bonus.over, lastWaveBonus: bonus };
  if (run.wave >= WAVE_COUNT - 1) return { ...next, phase: 'cleared', shop: null, afterShop: null };
  return openShop(next, 'nextWave');
}

/* ---------- ショップ ---------- */

function offerTaken(run: RunState, offers: readonly Offer[], o: Offer): boolean {
  if (o.kind === 'charm' && run.charms.includes(o.id)) return true;
  if (o.kind === 'equip' && run.equipment.includes(o.id)) return true;
  return offers.some(
    (x) => !x.sold && x.kind === o.kind && (x.kind === 'scroll' ? x.yaku === (o as { yaku: string }).yaku : (x as { id: string }).id === (o as { id: string }).id),
  );
}

function rollOffer(rng: number, run: RunState, offers: readonly Offer[]): [number, Offer] {
  let r = rng;
  for (let tries = 0; tries < 50; tries++) {
    let roll: number;
    let pick: number;
    [r, roll] = nextFloat(r);
    let offer: Offer;
    if (roll < 0.4) {
      [r, pick] = nextInt(r, CHARMS.length);
      const c = CHARMS[pick];
      offer = { kind: 'charm', id: c.id, price: c.price ?? PRICES.charm, sold: false };
    } else if (roll < 0.6) {
      [r, pick] = nextInt(r, CONSUMABLES.length);
      offer = { kind: 'consumable', id: CONSUMABLES[pick].id, price: PRICES.consumable, sold: false };
    } else if (roll < 0.75) {
      [r, pick] = nextInt(r, MODS.length);
      offer = { kind: 'mod', id: MODS[pick].id, price: PRICES.mod, sold: false };
    } else if (roll < 0.9) {
      [r, pick] = nextInt(r, SCROLL_YAKU.length);
      offer = { kind: 'scroll', yaku: SCROLL_YAKU[pick], price: PRICES.scroll, sold: false };
    } else {
      [r, pick] = nextInt(r, EQUIPMENT.length);
      const e = EQUIPMENT[pick];
      if (e.requires && !run.equipment.includes(e.requires)) continue;
      offer = { kind: 'equip', id: e.id, price: PRICES.equip, sold: false };
    }
    if (!offerTaken(run, offers, offer)) return [r, offer];
  }
  return [r, { kind: 'consumable', id: 'tsumo', price: PRICES.consumable, sold: false }];
}

function rollOffers(run: RunState): RunState {
  let rng = run.rng;
  const offers: Offer[] = [];
  for (let i = 0; i < 3; i++) {
    let o: Offer;
    [rng, o] = rollOffer(rng, run, offers);
    offers.push(o);
  }
  return { ...run, rng, shop: offers };
}

export function openShop(run: RunState, after: AfterShop): RunState {
  return rollOffers({ ...run, phase: 'shop', afterShop: after });
}

export function reroll(run: RunState): RunState {
  if (run.phase !== 'shop' || run.money < REROLL_PRICE) throw new Error('cannot reroll');
  return rollOffers({ ...run, money: run.money - REROLL_PRICE });
}

/**
 * 配列の index 番目。操作ログの index は信頼できない入力なので、整数で範囲内のときだけ返す
 * （"length" のような値で配列の長さを拾わないように）。
 */
function itemAt<T>(list: readonly T[] | null, index: number): T | undefined {
  return list && Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : undefined;
}

export function sellCharm(run: RunState, index: number): RunState {
  if (run.phase !== 'shop' || !itemAt(run.charms, index)) throw new Error('no such charm');
  return { ...run, charms: run.charms.filter((_, i) => i !== index), money: run.money + SELL_PRICE };
}

/** 牌の改造が選べる種類か */
export function canModify(comp: Composition, mod: ModId, k: Kind): boolean {
  if (!Number.isInteger(k) || k < 0 || k >= KIND_COUNT) return false;
  if (mod === 'nuki') return comp.count[k] > 0;
  if (mod === 'utsushi') return comp.count[k] > 0 && comp.count[k] < 5;
  if (mod === 'shu') return comp.red[k] < comp.count[k];
  return comp.red[k] + comp.gold[k] < comp.count[k];
}

function applyMod(comp: Composition, mod: ModId, k: Kind): Composition {
  const c = { count: comp.count.slice(), red: comp.red.slice(), gold: comp.gold.slice() };
  if (mod === 'shu') c.red[k] = Math.min(c.count[k], c.red[k] + 2);
  else if (mod === 'kin') c.gold[k] = Math.min(c.count[k] - c.red[k], c.gold[k] + 1);
  else if (mod === 'nuki') {
    c.count[k] = 0;
    c.red[k] = 0;
    c.gold[k] = 0;
  } else c.count[k] = 5;
  return c;
}

/** 品物を買う。牌の改造は対象の種類（target）が要る */
export function buy(run: RunState, index: number, target?: Kind): RunState {
  const offers = run.shop;
  const o = itemAt(offers, index);
  if (run.phase !== 'shop' || !offers || !o || o.sold) throw new Error('no such offer');
  if (run.money < o.price) throw new Error('not enough money');
  const next: RunState = { ...run, money: run.money - o.price, shop: offers.map((x, i) => (i === index ? { ...x, sold: true } : x)) };
  switch (o.kind) {
    case 'charm':
      if (run.charms.length >= MAX_CHARMS) throw new Error('charm slots are full');
      return { ...next, charms: [...run.charms, o.id] };
    case 'equip':
      return { ...next, equipment: [...run.equipment, o.id] };
    case 'consumable':
      if (run.consumables.length >= MAX_CONSUMABLES) throw new Error('consumable slots are full');
      return { ...next, consumables: [...run.consumables, o.id] };
    case 'scroll':
      return { ...next, yakuLevels: { ...run.yakuLevels, [o.yaku]: (run.yakuLevels[o.yaku] ?? 0) + 1 } };
    case 'mod':
      if (target === undefined || !canModify(run.composition, o.id, target)) throw new Error('invalid target');
      return { ...next, composition: applyMod(run.composition, o.id, target) };
  }
}

/** ショップを出て、次の局（または次の場）へ進む */
export function leaveShop(run: RunState): RunState {
  if (run.phase !== 'shop') throw new Error('not in the shop');
  const base = { ...run, phase: 'kyoku' as const, shop: null, afterShop: null };
  if (run.afterShop === 'sameKyoku') return base;
  if (run.afterShop === 'nextKyoku') return { ...base, round: { ...run.round, kyoku: run.round.kyoku + 1 } };
  const [rng, round] = newRound(run.rng, run.wave + 1);
  return { ...base, rng, wave: run.wave + 1, round, lastWaveBonus: null };
}

/** 局の中で消耗品を使ったら持ち物から外す（局の操作は kyoku.ts の step で行う） */
export function consumeConsumable(run: RunState, index: number): RunState {
  if (!itemAt(run.consumables, index)) throw new Error('no such consumable');
  return { ...run, consumables: run.consumables.filter((_, i) => i !== index) };
}
