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
  GACHA,
  GOLD_MONEY,
  GOLD_PER_MOD,
  MAX_CHARMS,
  MAX_CONSUMABLES,
  MODS,
  PRICES,
  REROLL_PRICE,
  SELL_PRICES,
  modifiersFor,
  type BaseRules,
  type BossId,
  type CharmDef,
  type CharmId,
  type EquipDef,
  type ConsumableId,
  type EquipId,
  type Loadout,
  type ModId,
  type Modifiers,
} from './items.js';
import { defaultComposition, startKyoku, type Composition, type KyokuResult, type KyokuState } from './kyoku.js';
import {
  DEFAULT_START,
  YAKUMAN_MARK,
  characterOf,
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
/** 場の名前（0: 東〜3: 北） */
export const WIND_NAMES = ['東', '南', '西', '北'] as const;
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
  /** オーラス（4 局目）でいちばん高かった和了の点数（和了っていなければ 0）。段位の突破の条件に使う */
  orasuWin: number;
  log: RoundLogEntry[];
}

/** ショップの品の種類の名前（画面と集計で同じものを使う） */
export const OFFER_KIND_LABEL = {
  charm: 'お守り',
  equip: '設備',
  consumable: '消耗品',
  mod: '牌の改造',
  scroll: '役の巻物',
} as const;

/** ショップの品の名前（「お守り:色眼鏡」「役の巻物:役牌」）。プレイの集計のキーに使う */
export function offerName(o: Offer): string {
  const defs = { charm: CHARMS, equip: EQUIPMENT, consumable: CONSUMABLES, mod: MODS } as const;
  const name = o.kind === 'scroll' ? o.yaku : ((defs[o.kind] as readonly { id: string; name: string }[]).find((d) => d.id === o.id)?.name ?? o.id);
  return `${OFFER_KIND_LABEL[o.kind]}:${name}`;
}

export type Offer =
  | { kind: 'charm'; id: CharmId; price: number; sold: boolean }
  | { kind: 'equip'; id: EquipId; price: number; sold: boolean }
  | { kind: 'consumable'; id: ConsumableId; price: number; sold: boolean }
  | { kind: 'mod'; id: ModId; price: number; sold: boolean }
  | { kind: 'scroll'; yaku: string; price: number; sold: boolean };

/** 場の突破で受け取った祝儀の内訳と福引き券 */
export interface WaveBonus {
  clear: number;
  interest: number;
  over: number;
  /** 福引き券の枚数（全場クリアではもう使えないので 0） */
  tickets: number;
}

export type RunPhase = 'kyoku' | 'shop' | 'over' | 'cleared';
/** ショップを出たあとに進む先（親の連荘のあいだはショップを開かない。settleKyoku） */
export type AfterShop = 'nextKyoku' | 'nextWave';

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
  /** 福引き券（祝儀を払わずに福引きを 1 回回せる）の枚数 */
  gachaTickets: number;
  /** 今のショップで回した福引きの結果（まだ回していなければ null。ショップを開くたびに戻す） */
  gacha: GachaResult | null;
  /** 直前の精算で、オーラスの和了の褒美にもらった品（もらっていなければ null。ショップを出ると戻す） */
  orasuPrize: Offer | null;
}

/** 福引きの結果 */
export interface GachaResult {
  /** 当たった品（はずれは null。はずれで戻った祝儀は gachaRefund） */
  prize: Offer | null;
  /** 福引き券で回した */
  ticket: boolean;
}

function newRound(rng: number, wave: number, targets: readonly number[]): [number, Round] {
  let r = rng;
  let dealer: number;
  let boss: number;
  [r, dealer] = nextInt(r, KYOKU_PER_WAVE);
  [r, boss] = nextInt(r, BOSSES.length);
  return [r, { kyoku: 0, score: 0, dealer, honba: 0, boss: BOSSES[boss].id, target: targets[wave], orasuWin: 0, log: [] }];
}

export interface RunOptions {
  /** 始めの条件（雀士・段位・解禁済みの役）。省略時は標準の雀士・初段・解禁なし */
  start?: RunStart;
  /** 基本ルールの上書き（シミュレーション用。画面とサーバーは start から決める） */
  base?: BaseRules;
  /** 最初から持たせるお守りと設備の追加（シミュレーション用） */
  loadout?: Loadout;
  /** 最初から当てておく牌の改造（シミュレーション用） */
  mods?: readonly { id: ModId; kind: Kind }[];
  /** 始めの祝儀の上書き（シミュレーション用） */
  money?: number;
}

/** 新しいラン。ルールと始めの持ち物は、始めの条件（雀士・段位）から決まる */
export function createRun(seed: number, options: RunOptions = {}): RunState {
  const start = options.start ?? DEFAULT_START;
  const rules = runRulesFor(start);
  const base = options.base ?? rules.base;
  const [rng, round] = newRound(createRng(mix32(seed)), 0, rules.targets);
  let composition = defaultComposition(base.redFives);
  for (const m of options.mods ?? []) {
    if (!canModify(composition, m.id, m.kind)) throw new Error(`cannot apply ${m.id} to ${m.kind}`);
    composition = applyMod(composition, m.id, m.kind);
  }
  return {
    seed,
    rng,
    start,
    base,
    yakuWon: [],
    wave: 0,
    money: options.money ?? rules.startMoney,
    // 雀士の固有のお守りは入れない（枠に数えず売れないので、雀士から毎回求める。innateCharms）
    charms: [...(options.loadout?.charms ?? [])],
    equipment: [...rules.equipment, ...(options.loadout?.equipment ?? [])],
    consumables: [],
    yakuLevels: {},
    composition,
    round,
    phase: 'kyoku',
    shop: null,
    afterShop: null,
    lastWaveBonus: null,
    waveScores: [],
    gachaTickets: 0,
    gacha: null,
    orasuPrize: null,
  };
}

/**
 * 雀士の固有のお守り（かめの黙聴など）。お守りの枠に数えず、売れない。
 * ランの状態の charms には入れず、始めの条件の雀士から求める
 */
export const innateCharms = (run: RunState): readonly CharmId[] => characterOf(run.start.character)?.charms ?? [];
/** 雀士の固有の設備（ねこの化け猫）。設備はもともと枠がなく売れないので、印を付けるためだけに使う */
export const innateEquipment = (run: RunState): readonly EquipId[] => characterOf(run.start.character)?.equipment ?? [];
/** 効いているお守りすべて（固有のお守り＋買ったお守り）。run.charms は枠の中身（買ったお守り）だけ */
export const ownedCharms = (run: RunState): CharmId[] => [...innateCharms(run), ...run.charms];
/** 局のルールに効く持ち物。お守りの効果はここからだけ読む（run.charms を直接読むと固有のお守りが抜ける） */
export const loadoutOf = (run: RunState): Loadout => ({ charms: ownedCharms(run), equipment: run.equipment });

export const bakazeOf = (run: RunState): Kind => EAST + run.wave;
export const isDealerKyoku = (run: RunState): boolean => run.round.kyoku === run.round.dealer;
/** 自風: 親の局は東、そこから逆算して南・西・北 */
export const seatOf = (run: RunState): Kind => EAST + ((((run.round.dealer - run.round.kyoku) % 4) + 4) % 4);
/** オーラス（場の 4 局目） */
export const isOrasu = (run: RunState): boolean => run.round.kyoku === KYOKU_PER_WAVE - 1;
export const bossOf = (run: RunState): BossId | null => (isOrasu(run) ? run.round.boss : null);

/**
 * 場を突破するのに要る、オーラスの和了の点数（段位の縛り。docs/SPEC.md §4.6）。条件がなければ null。
 * 点数を問わない段位では 1（どんな和了でもよい）
 */
export function orasuNeed(run: RunState): number | null {
  const share = runRulesFor(run.start).orasuWin;
  return share === null ? null : Math.max(1, Math.ceil((run.round.target * share) / 100) * 100);
}

/** 場の点数とオーラスの和了が、突破の条件を満たしているか */
export function waveClearedBy(run: RunState): boolean {
  const need = orasuNeed(run);
  return run.round.score >= run.round.target && (need === null || run.round.orasuWin >= need);
}

/** 今の局のルール（持ち物・ボス・親番・本場から決まる。AI の連荘の判断も、次の本場をこれで見積もる） */
export const kyokuModifiers = (run: RunState): Modifiers =>
  modifiersFor(run.base, loadoutOf(run), bossOf(run), isDealerKyoku(run), run.round.honba);

/** 今の局を始める。局の乱数はランの乱数から派生させる */
export function beginKyoku(run: RunState): { run: RunState; kyoku: KyokuState } {
  if (run.phase !== 'kyoku') throw new Error('not in a kyoku');
  const [rng, raw] = nextInt(run.rng, 0x7fffffff);
  const kyoku = startKyoku({
    rng: createRng(mix32(raw)),
    composition: run.composition,
    mods: kyokuModifiers(run),
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
  return base + result.gold * GOLD_MONEY;
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
  let gachaTickets = run.gachaTickets;
  if (result.type === 'win') {
    money += moneyForWin(result);
    gachaTickets += ticketsForWin(run, result);
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
  if (result.type === 'win' && isOrasu(run)) round.orasuWin = Math.max(round.orasuWin, result.score.points);
  // 親の連荘のあいだはショップを開かず、そのまま次の本場へ進む（連荘の和了のたびにショップで品を集められると、
  // 親番で連荘を続けてアイテムを集め放題になるため）。連荘が途切れたところでショップを開く
  const continues = result.type === 'win' && dealer && renchan;
  const next: RunState = {
    ...run,
    money,
    round: { ...round, honba: continues ? round.honba + 1 : 0 },
    yakuWon,
    gachaTickets,
    orasuPrize: null,
  };
  if (continues) return next;
  const settled = isOrasu(run) ? endWave(next) : openShop(next, 'nextKyoku');
  // オーラスで和了っていれば、品を 1 つもらう。オーラスのあとのショップは 1 度だけ開くので、連荘で何度和了っても 1 回。
  // ランが終わったら（場で負けた・全場クリア）、品はもう使えないので渡さない
  return isOrasu(run) && round.orasuWin > 0 && settled.phase === 'shop' ? giveOrasuPrize(settled) : settled;
}

/**
 * オーラスの和了の褒美（GitHub issue #9）。福引きと同じ景品から、はずれなしで 1 つ選んで持ち物に加える。
 * 福引きのない段位（雀聖）でももらえる。受け取れる品がどの種類にもなければ何ももらえない
 */
function giveOrasuPrize(run: RunState): RunState {
  const [rng, prize] = pickPrize(run.rng, run);
  const next: RunState = { ...run, rng, orasuPrize: prize };
  return prize ? receive(next, prize) : next;
}

function endWave(ended: RunState): RunState {
  const { score, target } = ended.round;
  const run = { ...ended, waveScores: [...ended.waveScores, score] };
  if (!waveClearedBy(run)) return { ...run, phase: 'over', shop: null, afterShop: null };
  /** 最後の場（突破すると全場クリアで、もうショップは開かない） */
  const last = run.wave >= WAVE_COUNT - 1;
  const bonus: WaveBonus = {
    // 突破の祝儀は段位で減る（progression.ts の runRulesFor）
    clear: runRulesFor(run.start).clearBonus,
    interest: Math.min(5, Math.floor(run.money / 5)),
    over: Math.max(0, Math.min(3, Math.floor((score / target - 1) / 0.5))),
    tickets: last || !hasGacha(run) ? 0 : 1,
  };
  const next = {
    ...run,
    money: run.money + bonus.clear + bonus.interest + bonus.over,
    gachaTickets: run.gachaTickets + bonus.tickets,
    lastWaveBonus: bonus,
  };
  if (last) return { ...next, phase: 'cleared', shop: null, afterShop: null };
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
  if (o.kind === 'charm' && ownedCharms(run).includes(o.id)) return true;
  if (o.kind === 'equip' && run.equipment.includes(o.id)) return true;
  return offers.some(
    (x) => !x.sold && x.kind === o.kind && (x.kind === 'scroll' ? x.yaku === (o as { yaku: string }).yaku : (x as { id: string }).id === (o as { id: string }).id),
  );
}

/* 品の作り方と、並べてよいかの条件（ショップの棚と福引きで同じものを使う） */

type OfferOf<K extends Offer['kind']> = Extract<Offer, { kind: K }>;
const charmOffer = (c: CharmDef): OfferOf<'charm'> => ({ kind: 'charm', id: c.id, price: c.price ?? PRICES.charm, sold: false });
const consumableOffer = (id: ConsumableId): OfferOf<'consumable'> => ({ kind: 'consumable', id, price: PRICES.consumable, sold: false });
const scrollOffer = (yaku: string): OfferOf<'scroll'> => ({ kind: 'scroll', yaku, price: PRICES.scroll, sold: false });
const equipOffer = (e: EquipDef): OfferOf<'equip'> => ({ kind: 'equip', id: e.id, price: PRICES.equip, sold: false });
/** 役で解禁されるお守りは、その役で和了ったことがあるときだけ並ぶ */
const charmListed = (run: RunState, c: CharmDef) => charmAvailable(c.id, run.start.unlockedYaku);
/** 前提の設備がある設備は、それを持っているときだけ並ぶ */
const equipListed = (run: RunState, e: EquipDef) => !e.requires || run.equipment.includes(e.requires);
/** 役の巻物は、その役で和了ったことがある役だけ */
const scrollsListed = (run: RunState) => scrollYakuAvailable(run.start.unlockedYaku);

/** お守りか消耗品の枠がいっぱいか */
function slotFull(run: RunState, kind: 'charm' | 'consumable'): boolean {
  return kind === 'charm' ? run.charms.length >= MAX_CHARMS : run.consumables.length >= MAX_CONSUMABLES;
}

function rollOffer(rng: number, run: RunState, offers: readonly Offer[]): [number, Offer] {
  let r = rng;
  for (let tries = 0; tries < 50; tries++) {
    let roll: number;
    let pick: number;
    [r, roll] = nextFloat(r);
    let offer: Offer;
    // 種類の出やすさ: お守り 35%・消耗品 20%・牌の改造 15%・役の巻物 15%・設備 15%
    // 並べられない品を引いたら引き直す（乱数の使い方を変えないため、候補を絞ってから引く形にはしない）
    if (roll < 0.35) {
      [r, pick] = nextInt(r, CHARMS.length);
      if (!charmListed(run, CHARMS[pick])) continue;
      offer = charmOffer(CHARMS[pick]);
    } else if (roll < 0.55) {
      [r, pick] = nextInt(r, CONSUMABLES.length);
      offer = consumableOffer(CONSUMABLES[pick].id);
    } else if (roll < 0.7) {
      [r, pick] = nextInt(r, MODS.length);
      offer = { kind: 'mod', id: MODS[pick].id, price: PRICES.mod, sold: false };
    } else if (roll < 0.85) {
      const yaku = scrollsListed(run);
      if (!yaku.length) continue;
      [r, pick] = nextInt(r, yaku.length);
      offer = scrollOffer(yaku[pick]);
    } else {
      [r, pick] = nextInt(r, EQUIPMENT.length);
      if (!equipListed(run, EQUIPMENT[pick])) continue;
      offer = equipOffer(EQUIPMENT[pick]);
    }
    if (!offerTaken(run, offers, offer)) return [r, offer];
  }
  return [r, consumableOffer('tsumo')];
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
  return rollOffers({ ...run, phase: 'shop', afterShop: after, gacha: null });
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

/** 売れる持ち物の種類 */
export type SellKind = keyof typeof SELL_PRICES;

/** 持っているお守りか消耗品（index 番目）を売って枠を空ける（ショップの中だけ） */
export function sell(run: RunState, kind: SellKind, index: number): RunState {
  const key = kind === 'charm' ? 'charms' : 'consumables';
  if (run.phase !== 'shop' || !itemAt(run[key], index)) throw new Error(`no such ${kind}`);
  return { ...run, [key]: run[key].filter((_, i) => i !== index), money: run.money + SELL_PRICES[kind] };
}

/** 牌の改造が選べる種類か */
export function canModify(comp: Composition, mod: ModId, k: Kind): boolean {
  if (!Number.isInteger(k) || k < 0 || k >= KIND_COUNT) return false;
  if (mod === 'nuki') return comp.count[k] > 0;
  if (mod === 'utsushi') return comp.count[k] > 0 && comp.count[k] < 5;
  // 朱塗り・金箔は、赤牌でも金牌でもない牌が残っているときだけ（1 枚の牌は赤と金を兼ねない）
  return comp.red[k] + comp.gold[k] < comp.count[k];
}

function applyMod(comp: Composition, mod: ModId, k: Kind): Composition {
  const c = { count: comp.count.slice(), red: comp.red.slice(), gold: comp.gold.slice() };
  if (mod === 'shu') c.red[k] = c.count[k] - c.gold[k];
  else if (mod === 'kin') c.gold[k] = Math.min(c.count[k] - c.red[k], c.gold[k] + GOLD_PER_MOD);
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
  if (o.kind === 'charm' && slotFull(run, 'charm')) return 'charmsFull';
  if (o.kind === 'consumable' && slotFull(run, 'consumable')) return 'consumablesFull';
  return null;
}

/** 品物を買う。牌の改造は対象の種類（target）が要る */
export function buy(run: RunState, index: number, target?: Kind): RunState {
  const blocker = buyBlocker(run, index);
  if (blocker) throw new Error(`cannot buy: ${blocker}`);
  const offers = run.shop!;
  const o = offers[index];
  const next: RunState = { ...run, money: run.money - o.price, shop: offers.map((x, i) => (i === index ? { ...x, sold: true } : x)) };
  if (o.kind === 'mod') {
    if (target === undefined || !canModify(run.composition, o.id, target)) throw new Error('invalid target');
    return { ...next, composition: applyMod(run.composition, o.id, target) };
  }
  return receive(next, o);
}

/** 品を持ち物に加える（牌の改造は対象が要るので buy が扱う） */
function receive(run: RunState, o: Exclude<Offer, { kind: 'mod' }>): RunState {
  switch (o.kind) {
    case 'charm':
      return { ...run, charms: [...run.charms, o.id] };
    case 'equip':
      return { ...run, equipment: [...run.equipment, o.id] };
    case 'consumable':
      return { ...run, consumables: [...run.consumables, o.id] };
    case 'scroll':
      return { ...run, yakuLevels: { ...run.yakuLevels, [o.yaku]: (run.yakuLevels[o.yaku] ?? 0) + 1 } };
  }
}

/**
 * 福引きで受け取れる品（種類ごと）。枠がいっぱいの種類と、持っているお守り・設備は除く。
 * 棚に並んでいるお守り・設備も除く（当たったあとに棚から買うと、同じ品を 2 つ持てるため）
 */
function gachaPrizes(run: RunState): Record<GachaKind, OfferOf<GachaKind>[]> {
  const free = (o: Offer) => !offerTaken(run, run.shop ?? [], o);
  return {
    consumable: slotFull(run, 'consumable') ? [] : CONSUMABLES.map((c) => consumableOffer(c.id)),
    charm: slotFull(run, 'charm') ? [] : CHARMS.filter((c) => charmListed(run, c)).map(charmOffer).filter(free),
    scroll: scrollsListed(run).map(scrollOffer),
    equip: EQUIPMENT.filter((e) => equipListed(run, e)).map(equipOffer).filter(free),
  };
}

type GachaKind = keyof typeof GACHA.weights;

/** 福引きがある段位か（雀聖にはない） */
export const hasGacha = (run: RunState): boolean => runRulesFor(run.start).gacha;

/** 福引きを回せるか。ショップを開くたびに 1 回まで。福引き券があれば祝儀は要らない */
export function canGacha(run: RunState): boolean {
  return hasGacha(run) && run.phase === 'shop' && !run.gacha && (run.gachaTickets > 0 || run.money >= GACHA.price);
}

/**
 * 福引きを回す。福引き券があれば先に使う。はずれ（GACHA.missRate）でなければ、受け取れる品のある種類を
 * 出やすさの重みで選び、その中から 1 つを持ち物に加える。受け取れる品がどの種類にもなければはずれ
 */
export function gacha(run: RunState): RunState {
  if (!canGacha(run)) throw new Error('cannot gacha');
  let r = run.rng;
  let roll: number;
  [r, roll] = nextFloat(r);
  let prize: OfferOf<GachaKind> | null = null;
  if (roll >= GACHA.missRate) [r, prize] = pickPrize(r, run);
  const ticket = run.gachaTickets > 0;
  const next: RunState = {
    ...run,
    rng: r,
    gachaTickets: run.gachaTickets - (ticket ? 1 : 0),
    money: run.money - (ticket ? 0 : GACHA.price) + gachaRefund({ prize, ticket }),
    gacha: { prize, ticket },
  };
  return prize ? receive(next, prize) : next;
}

/**
 * 景品を 1 つ選ぶ（福引きの当たりと、オーラスの和了の褒美）。受け取れる品のある種類を出やすさの重みで選び、
 * その中から 1 つ。受け取れる品がどの種類にもなければ null（乱数は使わない）
 */
function pickPrize(rng: number, run: RunState): [number, OfferOf<GachaKind> | null] {
  const prizes = gachaPrizes(run);
  const kinds = (Object.keys(GACHA.weights) as GachaKind[]).filter((k) => prizes[k].length);
  if (!kinds.length) return [rng, null];
  let r = rng;
  let pick: number;
  [r, pick] = nextInt(r, kinds.reduce((a, k) => a + GACHA.weights[k], 0));
  const kind = kinds.find((k) => (pick -= GACHA.weights[k]) < 0)!;
  [r, pick] = nextInt(r, prizes[kind].length);
  return [r, prizes[kind][pick]];
}

/** 福引きのはずれで戻った祝儀（祝儀で回したときだけ戻る） */
export const gachaRefund = (g: GachaResult): number => (g.prize || g.ticket ? 0 : GACHA.missRefund);

/**
 * 和了でもらう福引き券（金牌を使って和了ると、金牌の枚数によらず 1 枚）。
 * 最後の場の最後の局の和了なら、あとにショップが開かないので渡さない（親の連荘のあいだもショップは開かない）
 */
export function ticketsForWin(run: RunState, result: Extract<KyokuResult, { type: 'win' }>): number {
  const noMoreShop = run.wave >= WAVE_COUNT - 1 && isOrasu(run);
  return result.gold > 0 && !noMoreShop && hasGacha(run) ? 1 : 0;
}

/** ショップを出て、次の局（または次の場）へ進む */
export function leaveShop(run: RunState): RunState {
  if (run.phase !== 'shop') throw new Error('not in the shop');
  const base = { ...run, phase: 'kyoku' as const, shop: null, afterShop: null, orasuPrize: null };
  if (run.afterShop === 'nextKyoku') return { ...base, round: { ...run.round, kyoku: run.round.kyoku + 1 } };
  const [rng, round] = newRound(run.rng, run.wave + 1, runRulesFor(run.start).targets);
  return { ...base, rng, wave: run.wave + 1, round, lastWaveBonus: null };
}

/** 局の中で消耗品を使ったら持ち物から外す（局の操作は kyoku.ts の step で行う） */
export function consumeConsumable(run: RunState, index: number): RunState {
  if (!itemAt(run.consumables, index)) throw new Error('no such consumable');
  return { ...run, consumables: run.consumables.filter((_, i) => i !== index) };
}
