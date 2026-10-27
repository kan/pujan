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
  EQUIPMENT,
  MAX_CHARMS,
  MAX_CONSUMABLES,
  MODS,
  PRICES,
  REROLL_PRICE,
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
import {
  DEFAULT_START,
  YAKUMAN_MARK,
  charmAvailable,
  runRulesFor,
  scrollYakuAvailable,
  type RunStart,
} from './progression.js';
import type { FinalScore } from './score.js';
import { createRng, mix32, nextFloat, nextInt } from './rng.js';
import { EAST, KIND_COUNT, type Kind } from './tiles.js';

// 場の目標点・始めの祝儀・ショップの品の数は雀士と段位で変わる（progression.ts の runRulesFor）
export const WAVE_COUNT = 4;
export const KYOKU_PER_WAVE = 4;
/** 流局時に聴牌していたときの祝儀 */
export const TENPAI_MONEY = 1;

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
  /** 始めの条件（雀士・段位・解禁済みの役） */
  start: RunStart;
  /** 基本ルール（雀士と段位から決まる。目標点・ショップの品の数は start から runRulesFor で引く） */
  base: BaseRules;
  /** このランで和了った役の名前（解禁に使う。progression.ts の progressAfter） */
  yakuWon: string[];
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
  /** 終わった場の点数（突破できなかった最後の場を含む）。ランキングの合計点に使う */
  waveScores: number[];
}

function newRound(rng: number, wave: number, targets: readonly number[]): [number, Round] {
  let r = rng;
  let dealer: number;
  let boss: number;
  [r, dealer] = nextInt(r, KYOKU_PER_WAVE);
  [r, boss] = nextInt(r, BOSSES.length);
  return [r, { kyoku: 0, score: 0, dealer, honba: 0, boss: BOSSES[boss].id, target: targets[wave], log: [] }];
}

export interface RunOptions {
  /** 始めの条件（雀士・段位・解禁済みの役）。省略時は標準の雀士・初段・解禁なし */
  start?: RunStart;
  /** 基本ルールの上書き（シミュレーション用。画面とサーバーは start から決める） */
  base?: BaseRules;
  /** 最初から持たせるお守りと設備の追加（シミュレーション用） */
  loadout?: Loadout;
}

/** 新しいラン。ルールと始めの持ち物は、始めの条件（雀士・段位）から決まる */
export function createRun(seed: number, options: RunOptions = {}): RunState {
  const start = options.start ?? DEFAULT_START;
  const rules = runRulesFor(start);
  const base = options.base ?? rules.base;
  const [rng, round] = newRound(createRng(mix32(seed)), 0, rules.targets);
  return {
    seed,
    rng,
    start,
    base,
    yakuWon: [],
    wave: 0,
    money: rules.startMoney,
    charms: [...rules.charms, ...(options.loadout?.charms ?? [])],
    equipment: [...rules.equipment, ...(options.loadout?.equipment ?? [])],
    consumables: [],
    yakuLevels: {},
    composition: defaultComposition(base.redFives),
    round,
    phase: 'kyoku',
    shop: null,
    afterShop: null,
    lastWaveBonus: null,
    waveScores: [],
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
 * 場の記録に残す和了の名前。点数の内訳から役と上限（満貫など）の行だけを並べる
 * （プロトタイプと同じ。倍率やボーナスの行は入れない）。
 */
function winLabel(score: FinalScore): string {
  return score.lines
    .filter((l) => l.kind === 'yaku' || l.kind === 'limit')
    .map((l) => l.label)
    .join('・');
}

/**
 * 局の結果を精算する。親の和了では renchan で連荘か和了やめかを選ぶ。
 * 4 局目のあとは場の判定に進み、それ以外はショップを開く。
 */
export function settleKyoku(run: RunState, result: KyokuResult, renchan = false): RunState {
  const dealer = isDealerKyoku(run);
  const round: Round = { ...run.round, score: run.round.score + pointsDelta(result), log: run.round.log.slice() };
  let money = run.money;
  let yakuWon = run.yakuWon;
  if (result.type === 'win') {
    money += moneyForWin(result);
    // 解禁に使う（ボーナスの翻・役満の名前も含める。役満なら印も入れる）
    const ev = result.win.evaluation;
    const names = ev.yaku.map((y) => y.name);
    if (ev.yakuman) names.push(YAKUMAN_MARK);
    yakuWon = [...new Set([...yakuWon, ...names])];
    round.log.push({
      kyoku: round.kyoku,
      honba: round.honba,
      label: winLabel(result.score),
      points: result.score.points,
      dealer,
    });
  } else {
    if (result.tenpai) money += TENPAI_MONEY;
    round.log.push({
      kyoku: round.kyoku,
      honba: round.honba,
      label: (result.tenpai ? '流局（聴牌）' : '流局') + (result.stickLost ? '・リーチ棒没収' : ''),
      points: pointsDelta(result),
      dealer,
    });
  }
  const next: RunState = { ...run, money, round, yakuWon };
  if (result.type === 'win' && dealer && renchan) {
    next.round = { ...round, honba: round.honba + 1 };
    return openShop(next, 'sameKyoku');
  }
  next.round = { ...round, honba: 0 };
  if (round.kyoku >= KYOKU_PER_WAVE - 1) return endWave(next);
  return openShop(next, 'nextKyoku');
}

function endWave(ended: RunState): RunState {
  const { score, target } = ended.round;
  const run = { ...ended, waveScores: [...ended.waveScores, score] };
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

/** 終わったランの成績（ランキングに使う。docs/SPEC.md §5.4） */
export interface RunSummary {
  /** 突破した場の数（0〜4。4 は全場クリア） */
  wavesCleared: number;
  /** 終わった場の点数の合計 */
  totalScore: number;
}

export function runSummary(run: RunState): RunSummary {
  if (run.phase !== 'over' && run.phase !== 'cleared') throw new Error('run has not finished');
  return {
    wavesCleared: run.phase === 'cleared' ? WAVE_COUNT : run.wave,
    totalScore: run.waveScores.reduce((a, s) => a + s, 0),
  };
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
      // 役で解禁されるお守りは、その役で和了ったことがあるときだけ並ぶ
      if (!charmAvailable(c.id, run.start.unlockedYaku)) continue;
      offer = { kind: 'charm', id: c.id, price: c.price ?? PRICES.charm, sold: false };
    } else if (roll < 0.6) {
      [r, pick] = nextInt(r, CONSUMABLES.length);
      offer = { kind: 'consumable', id: CONSUMABLES[pick].id, price: PRICES.consumable, sold: false };
    } else if (roll < 0.75) {
      [r, pick] = nextInt(r, MODS.length);
      offer = { kind: 'mod', id: MODS[pick].id, price: PRICES.mod, sold: false };
    } else if (roll < 0.9) {
      // 役の巻物は、その役で和了ったことがある役だけ（まだなければ別の品を引き直す）
      const yaku = scrollYakuAvailable(run.start.unlockedYaku);
      if (!yaku.length) continue;
      [r, pick] = nextInt(r, yaku.length);
      offer = { kind: 'scroll', yaku: yaku[pick], price: PRICES.scroll, sold: false };
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
  const size = runRulesFor(run.start).shopSize;
  for (let i = 0; i < size; i++) {
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

/** 品物を買えない理由（買えるなら null）。画面はこれで案内を出し、buy() も同じ理由で断る */
export type BuyBlocker = 'noOffer' | 'sold' | 'money' | 'charmsFull' | 'consumablesFull';

export function buyBlocker(run: RunState, index: number): BuyBlocker | null {
  const o = itemAt(run.shop, index);
  if (run.phase !== 'shop' || !o) return 'noOffer';
  if (o.sold) return 'sold';
  if (run.money < o.price) return 'money';
  if (o.kind === 'charm' && run.charms.length >= MAX_CHARMS) return 'charmsFull';
  if (o.kind === 'consumable' && run.consumables.length >= MAX_CONSUMABLES) return 'consumablesFull';
  return null;
}

/** 品物を買う。牌の改造は対象の種類（target）が要る */
export function buy(run: RunState, index: number, target?: Kind): RunState {
  const blocker = buyBlocker(run, index);
  if (blocker) throw new Error(`cannot buy: ${blocker}`);
  const offers = run.shop!;
  const o = offers[index];
  const next: RunState = { ...run, money: run.money - o.price, shop: offers.map((x, i) => (i === index ? { ...x, sold: true } : x)) };
  switch (o.kind) {
    case 'charm':
      return { ...next, charms: [...run.charms, o.id] };
    case 'equip':
      return { ...next, equipment: [...run.equipment, o.id] };
    case 'consumable':
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
  const [rng, round] = newRound(run.rng, run.wave + 1, runRulesFor(run.start).targets);
  return { ...base, rng, wave: run.wave + 1, round, lastWaveBonus: null };
}

/** 局の中で消耗品を使ったら持ち物から外す（局の操作は kyoku.ts の step で行う） */
export function consumeConsumable(run: RunState, index: number): RunState {
  if (!itemAt(run.consumables, index)) throw new Error('no such consumable');
  return { ...run, consumables: run.consumables.filter((_, i) => i !== index) };
}
