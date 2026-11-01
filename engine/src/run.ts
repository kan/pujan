/**
 * ローグライトのラン。仕様は docs/SPEC.md §4「ローグライト」。
 *
 * 1 ランは東風戦（東 1〜4 局）。始めに掲げたお題（mission.ts）を、東 4 局を終えたときに 1 つ以上果たしていればクリア。
 * ランの始め（東 1 局の前）と、東 1〜3 局のあとにショップが開く。
 * 局そのものは kyoku.ts が進め、ここは局の結果の精算・ランの進行・ショップを受け持つ。
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
import { metTimes, missionResults, rollMissions, wonYakuNames, type Mission, type MissionResult } from './mission.js';
import {
  DEFAULT_START,
  characterOf,
  charmAvailable,
  runRulesFor,
  scrollYakuAvailable,
  type RunStart,
} from './progression.js';
import type { FinalScore } from './score.js';
import { createRng, mix32, nextFloat, nextInt } from './rng.js';
import { EAST, KIND_COUNT, type Kind } from './tiles.js';

// お題・始めの祝儀・ショップの品の数は雀士と段位で変わる（progression.ts の runRulesFor）
/** 1 ランの局の数（東 1〜4 局。親の連荘のぶんは数えない） */
export const KYOKU_COUNT = 4;
/** 流局時に聴牌していたときの祝儀 */
export const TENPAI_MONEY = 1;
/** 利子: 東 1〜3 局のあとにショップを開くとき、持っている祝儀 INTEREST_STEP ごとに 1（最大 INTEREST_MAX） */
export const INTEREST_STEP = 5;
export const INTEREST_MAX = 3;

export interface RoundLogEntry {
  kyoku: number;
  honba: number;
  /** 役の並び、または「流局（聴牌）」など */
  label: string;
  points: number;
  dealer: boolean;
}

/** 東風戦（東 1〜4 局）の状態 */
export interface Round {
  /** 0〜3（東1局〜東4局） */
  kyoku: number;
  /** 4 局の合計点（流局の聴牌料・罰符・リーチ棒を含む） */
  score: number;
  /** 和了の回数（連荘の和了も数える） */
  wins: number;
  /** 親番の局（0〜3） */
  dealer: number;
  honba: number;
  /** オーラス（東 4 局）のボス */
  boss: BossId;
  /** オーラス（東 4 局）でいちばん高かった和了の点数（和了っていなければ 0）。段位のクリアの条件に使う */
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

/** over はお題を 1 つも果たせずに終わったラン（か段位の縛りを満たせなかったラン）、cleared はクリア */
export type RunPhase = 'kyoku' | 'shop' | 'over' | 'cleared';
/** ショップを出たあとに進む先（最初のショップは東 1 局へ。親の連荘のあいだはショップを開かない。settleKyoku） */
export type AfterShop = 'firstKyoku' | 'nextKyoku';

export interface RunState {
  seed: number;
  rng: number;
  /** 始めの条件（雀士・段位・解禁済みの役） */
  start: RunStart;
  /** 基本ルール（雀士と段位から決まる。目標点・ショップの品の数は start から runRulesFor で引く） */
  base: BaseRules;
  /** このランで和了った役の名前（役のお題と解禁に使う。progression.ts の progressAfter） */
  yakuWon: string[];
  /** このランのお題（同時に掲げる。種類は重ならない） */
  missions: Mission[];
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
  /** 今のショップを開くときにもらった利子（最初のショップと、ショップの外では 0） */
  interest: number;
  /** 福引き券（祝儀を払わずに福引きを 1 回回せる）の枚数 */
  gachaTickets: number;
  /** 今のショップで回した福引きの結果（まだ回していなければ null。ショップを開くたびに戻す） */
  gacha: GachaResult | null;
}

/** 福引きの結果 */
export interface GachaResult {
  /** 当たった品（はずれは null。はずれで戻った祝儀は gachaRefund） */
  prize: Offer | null;
  /** 福引き券で回した */
  ticket: boolean;
}

function newRound(rng: number): [number, Round] {
  let r = rng;
  let dealer: number;
  let boss: number;
  [r, dealer] = nextInt(r, KYOKU_COUNT);
  [r, boss] = nextInt(r, BOSSES.length);
  return [r, { kyoku: 0, score: 0, wins: 0, dealer, honba: 0, boss: BOSSES[boss].id, orasuWin: 0, log: [] }];
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
  const [rng0, round] = newRound(createRng(mix32(seed)));
  const [rng, missions] = rollMissions(rng0, rules.missionSlots);
  let composition = defaultComposition(base.redFives);
  for (const m of options.mods ?? []) {
    if (!canModify(composition, m.id, m.kind)) throw new Error(`cannot apply ${m.id} to ${m.kind}`);
    composition = applyMod(composition, m.id, m.kind);
  }
  // 最初のショップ（東 1 局の前）から始まる
  return openShop({
    seed,
    rng,
    start,
    base,
    yakuWon: [],
    missions,
    money: options.money ?? rules.startMoney,
    // 雀士の固有のお守りは入れない（枠に数えず売れないので、雀士から毎回求める。innateCharms）
    charms: [...(options.loadout?.charms ?? [])],
    equipment: [...rules.equipment, ...(options.loadout?.equipment ?? [])],
    consumables: [],
    yakuLevels: {},
    composition,
    round,
    phase: 'shop',
    shop: null,
    afterShop: null,
    interest: 0,
    gachaTickets: 0,
    gacha: null,
  }, 'firstKyoku');
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

/** 場風（東風戦なのでいつも東） */
export const bakazeOf = (_run: RunState): Kind => EAST;
export const isDealerKyoku = (run: RunState): boolean => run.round.kyoku === run.round.dealer;
/** 自風: 親の局は東、そこから逆算して南・西・北 */
export const seatOf = (run: RunState): Kind => EAST + ((((run.round.dealer - run.round.kyoku) % 4) + 4) % 4);
/** オーラス（東 4 局） */
export const isOrasu = (run: RunState): boolean => run.round.kyoku === KYOKU_COUNT - 1;
export const bossOf = (run: RunState): BossId | null => (isOrasu(run) ? run.round.boss : null);

/**
 * クリアに要る、オーラスの和了の点数（段位の縛り。docs/SPEC.md §4.6）。条件がなければ null。
 * 点数を問わない段位では 1（どんな和了でもよい）
 */
export function orasuNeed(run: RunState): number | null {
  const need = runRulesFor(run.start).orasuWin;
  return need === null ? null : Math.max(1, need);
}

/** お題の進み具合を見るための記録（mission.ts の missionMet に渡す） */
export const missionProgressOf = (run: RunState) => ({ wins: run.round.wins, points: run.round.score, yakuWon: run.yakuWon });

/** お題ごとに、今の時点で果たしているかを添える */
export const missionResultsOf = (run: RunState): MissionResult[] => missionResults(run.missions, missionProgressOf(run));

/** お題を 1 つ以上果たしているか */
export const anyMissionDone = (run: RunState): boolean => missionResultsOf(run).some((r) => r.met);

/** お題とオーラスの和了（段位の縛り）が、クリアの条件を満たしているか */
export function clearedBy(run: RunState): boolean {
  const need = orasuNeed(run);
  return anyMissionDone(run) && (need === null || run.round.orasuWin >= need);
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

/** 和了の祝儀: 2＋翻数の半分（最大 6）、役満は 6、金牌 1 枚につき＋2。段位の縛りで減る（0 より下にはしない） */
export function moneyForWin(run: RunState, result: Extract<KyokuResult, { type: 'win' }>): number {
  const ev = result.win.evaluation;
  const base = ev.yakuman ? 6 : 2 + Math.min(4, Math.floor(ev.han / 2));
  return Math.max(0, base + runRulesFor(run.start).winMoneyDelta) + result.gold * GOLD_MONEY;
}

/** 東 1〜3 局のあとにショップを開くときの利子 */
export const interestFor = (money: number): number => Math.min(INTEREST_MAX, Math.floor(money / INTEREST_STEP));

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
 * 東 4 局のあとはランの判定に進み、それ以外は利子を渡してショップを開く。
 */
export function settleKyoku(run: RunState, result: KyokuResult, renchan = false): RunState {
  const dealer = isDealerKyoku(run);
  const round: Round = { ...run.round, score: run.round.score + pointsDelta(result), log: run.round.log.slice() };
  let money = run.money;
  let yakuWon = run.yakuWon;
  let gachaTickets = run.gachaTickets;
  if (result.type === 'win') {
    round.wins++;
    money += moneyForWin(run, result);
    gachaTickets += ticketsForWin(run, result);
    // 役のお題と解禁に使う（ボーナスの翻・役満の名前も含める。役満なら印も入れる）
    yakuWon = [...new Set([...yakuWon, ...wonYakuNames(result.win.evaluation)])];
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
  };
  if (continues) return next;
  if (isOrasu(run)) return { ...next, phase: clearedBy(next) ? 'cleared' : 'over', shop: null, afterShop: null };
  const interest = interestFor(next.money);
  return openShop({ ...next, money: next.money + interest }, 'nextKyoku', interest);
}

/** 終わったランの成績（ランキングに使う。docs/SPEC.md §4.1・§5.4） */
export interface RunSummary {
  /** お題（果たしたかを添える） */
  missions: MissionResult[];
  cleared: boolean;
  /** 記録点に掛けた倍率（果たしたお題の倍率の合計。クリアしなければ 1） */
  times: number;
  /** 4 局の合計点 */
  totalScore: number;
  /** 記録点（クリアしたときだけ、合計点に倍率を掛ける） */
  recordScore: number;
}

/**
 * ランキングに記録した成績。4 場の形で記録した行は、お題が null で、クリアなし・記録点 0（16 局の合計点は totalScore）
 */
export type RecordedSummary = Omit<RunSummary, 'missions'> & { missions: MissionResult[] | null };

/**
 * お題の結果・クリアしたか・合計点から成績を組み立てる（サーバーが記録した行から作り直すときも同じ規則にする）。
 * 記録点の端数は四捨五入（合計点は 100 点単位なので、×1.5 などでは 50 点単位になる）
 */
export function summaryOf(missions: MissionResult[], cleared: boolean, totalScore: number): RunSummary {
  const times = cleared ? metTimes(missions) : 1;
  return { missions, cleared, times, totalScore, recordScore: Math.round(totalScore * times) };
}

export function runSummary(run: RunState): RunSummary {
  if (run.phase !== 'over' && run.phase !== 'cleared') throw new Error('run has not finished');
  return summaryOf(missionResultsOf(run), run.phase === 'cleared', run.round.score);
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

/** ショップを開く。interest は、開くときにもらった利子（画面に出すだけ。祝儀には足してから渡す） */
export function openShop(run: RunState, after: AfterShop, interest = 0): RunState {
  return rollOffers({ ...run, phase: 'shop', afterShop: after, interest, gacha: null });
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
 * 福引きの景品を 1 つ選ぶ。受け取れる品のある種類を出やすさの重みで選び、
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
 * 東 4 局の和了なら、あとにショップが開かないので渡さない（親の連荘のあいだもショップは開かない）
 */
export function ticketsForWin(run: RunState, result: Extract<KyokuResult, { type: 'win' }>): number {
  return result.gold > 0 && !isOrasu(run) && hasGacha(run) ? 1 : 0;
}

/**
 * 次に打つ局（0〜3）。ショップでは、出たあとに始まる局（最初のショップのあとは東 1 局、それ以外は次の局）。
 * 精算では局を進めず、ショップを出るときに進める
 */
export const upcomingKyoku = (run: RunState): number =>
  run.phase === 'shop' && run.afterShop === 'nextKyoku' ? run.round.kyoku + 1 : run.round.kyoku;

/** ショップを出て、局へ進む */
export function leaveShop(run: RunState): RunState {
  if (run.phase !== 'shop') throw new Error('not in the shop');
  const round = { ...run.round, kyoku: upcomingKyoku(run) };
  return { ...run, phase: 'kyoku', shop: null, afterShop: null, interest: 0, round };
}

/** 局の中で消耗品を使ったら持ち物から外す（局の操作は kyoku.ts の step で行う） */
export function consumeConsumable(run: RunState, index: number): RunState {
  if (!itemAt(run.consumables, index)) throw new Error('no such consumable');
  return { ...run, consumables: run.consumables.filter((_, i) => i !== index) };
}
