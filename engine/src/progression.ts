/**
 * 引き継ぎ（docs/SPEC.md §4.6）: 雀士、段位、役の解禁。強さではなく選択肢を増やす。
 *
 * - 雀士: 始めの条件（保留枠・ネクスト・持ち物・祝儀）が違う
 * - 段位: 初段〜雀聖。上がるほど縛りが重なる。その段位で全場クリアすると次が解禁される
 * - 役の解禁: その役で一度和了ると、その役の巻物（と、unlockYaku を持つお守り）がショップに並ぶ
 *
 * ランの始めの条件（RunStart）は操作ログに入り、サーバーが同じ条件で再生して確かめる。
 * 解禁の状態（Progress）は、サーバーで確かめたランから progressAfter で更新する。
 */
import { CHARMS, DEFAULT_BASE_RULES, SCROLL_YAKU, type BaseRules, type CharmId, type EquipId } from './items.js';
import { runSummary, type RunState } from './run.js';

/** 場の目標点（初段） */
export const BASE_WAVE_TARGETS: readonly number[] = [1000, 2000, 4000, 8000];
/** 始めの祝儀（標準の雀士・初段） */
const BASE_START_MONEY = 4;
/** ショップの品の数（段位の縛りがないとき） */
const BASE_SHOP_SIZE = 3;

/**
 * 役満で和了ったときに、和了った役の一覧（yakuWon）へ役の名前と一緒に入れる印。
 * 役満の名前を並べた一覧を持たずに、雀士「ねこ」（役満型）の解禁を判定するため
 */
export const YAKUMAN_MARK = '役満';

/* ---------- 解禁の状態 ---------- */

export interface Progress {
  /** 一度でも和了った役の名前（ボーナスの翻・役満を含む。役満では YAKUMAN_MARK も入る） */
  yakuWon: string[];
  /** 突破した場の数のいちばん多い記録（0〜4。段位は問わない） */
  bestWaves: number;
  /** 全場クリアしたいちばん高い段位（-1 はまだ） */
  danCleared: number;
}

export const EMPTY_PROGRESS: Progress = { yakuWon: [], bestWaves: 0, danCleared: -1 };

/** 解禁の状態の形が正しいか（端末に保存したものは信頼できない入力なので、読むときに確かめる） */
export function isProgress(v: unknown): v is Progress {
  const p = v as Partial<Progress> | null;
  return (
    !!p &&
    Array.isArray(p.yakuWon) &&
    p.yakuWon.every((y) => typeof y === 'string') &&
    Number.isInteger(p.bestWaves) &&
    Number.isInteger(p.danCleared)
  );
}

/* ---------- 雀士 ---------- */

export type CharacterId = 'standard' | 'speed' | 'menzen' | 'oya' | 'yakuman';

export interface CharacterDef {
  id: CharacterId;
  /** 動物の名前（ひらがな）。絵は frontend/public/characters/<id>.svg */
  name: string;
  description: string;
  /** 基本ルールとの違い */
  base: Partial<BaseRules>;
  charms: CharmId[];
  equipment: EquipId[];
  /** 始めの祝儀（段位で減る前） */
  money: number;
  /** 解禁の条件（画面に出す） */
  unlockText: string;
  unlocked: (p: Progress) => boolean;
}

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: 'standard',
    name: 'くま',
    description: '標準型。保留3枠・ネクスト2枚。持ち物なしで始める',
    base: {},
    charms: [],
    equipment: [],
    money: BASE_START_MONEY,
    unlockText: '最初から',
    unlocked: () => true,
  },
  {
    id: 'speed',
    name: 'うさぎ',
    description: '速攻型。保留4枠・ネクスト1枚。保留で早く和了る',
    base: { holdSlots: 4, next: 1 },
    charms: [],
    equipment: [],
    money: BASE_START_MONEY,
    unlockText: '東場を突破する',
    unlocked: (p) => p.bestWaves >= 1,
  },
  {
    id: 'menzen',
    name: 'かめ',
    description: '門前型。保留なし・ネクスト3枚。黙聴（門前が2翻）を持って始める',
    base: { holdSlots: 0, next: 3 },
    charms: ['damaten'],
    equipment: [],
    money: BASE_START_MONEY,
    unlockText: '門前で和了る',
    unlocked: (p) => p.yakuWon.includes('門前'),
  },
  {
    id: 'oya',
    name: 'ぞう',
    description: '親番型。親父の背中（親の倍率が2倍）を持って始める。祝儀は0から',
    base: {},
    charms: ['oyaji'],
    equipment: [],
    money: 0,
    unlockText: '南場を突破する',
    unlocked: (p) => p.bestWaves >= 2,
  },
  {
    id: 'yakuman',
    name: 'ねこ',
    description: '役満型。化け猫（ドラが万能牌）を持って始める。保留2枠、祝儀は0から',
    base: { holdSlots: 2 },
    charms: [],
    equipment: ['joker'],
    money: 0,
    unlockText: '役満で和了る',
    unlocked: (p) => p.yakuWon.includes(YAKUMAN_MARK),
  },
];

const characterOf = (id: string): CharacterDef | undefined => CHARACTERS.find((c) => c.id === id);

/** 雀士の名前（知らない ID はそのまま） */
export const characterName = (id: string): string => characterOf(id)?.name ?? id;

/** 雀士が選べるか（解禁済みか） */
export const characterUnlocked = (p: Progress, id: string): boolean => !!characterOf(id)?.unlocked(p);

/* ---------- 段位 ---------- */

export interface DanDef {
  /** 0〜5（初段〜雀聖） */
  level: number;
  name: string;
  /** この段位で加わる縛り（画面に出す） */
  description: string;
  /*
   * 縛りの中身。ある段位のランには、その段位までのすべての縛りが重なる。
   * targetTimes と shopSize は上の段位の値で置き換え、moneyDelta と turnsDelta は足す
   */
  targetTimes?: number;
  moneyDelta?: number;
  turnsDelta?: number;
  shopSize?: number;
}

export const DANS: readonly DanDef[] = [
  { level: 0, name: '初段', description: '縛りなし' },
  { level: 1, name: '二段', description: '場の目標点が1.5倍', targetTimes: 1.5 },
  { level: 2, name: '三段', description: '始めの祝儀が2少ない', moneyDelta: -2 },
  { level: 3, name: '四段', description: '1局が11巡', turnsDelta: -1 },
  { level: 4, name: '五段', description: '場の目標点が2倍（二段の1.5倍の代わり）', targetTimes: 2 },
  { level: 5, name: '雀聖', description: 'ショップの品が2つ', shopSize: 2 },
];

export const danName = (level: number): string => DANS[level]?.name ?? `${level}`;

/** 選べる段位のいちばん上 */
export const maxDan = (p: Progress): number => Math.min(DANS.length - 1, p.danCleared + 1);

/* ---------- ランの始めの条件 ---------- */

/** ランを始めるときに選ぶもの */
export interface RunChoice {
  character: CharacterId;
  /** 段位（0〜5） */
  dan: number;
}

/** ランの始めの条件。操作ログに入る */
export interface RunStart extends RunChoice {
  /** 始めた時点で解禁されていた役（一度和了った役の名前。ランキングに載るランではサーバーが渡す） */
  unlockedYaku: string[];
}

export const DEFAULT_START: RunStart = { character: 'standard', dan: 0, unlockedYaku: [] };

/** 雀士と段位の形が正しいか（保存したものや操作ログは信頼できない入力なので、使う前に確かめる） */
export function isRunChoice(v: unknown): v is RunChoice {
  const c = v as Partial<RunChoice> | null;
  return !!c && !!characterOf(c.character ?? '') && Number.isInteger(c.dan) && c.dan! >= 0 && c.dan! < DANS.length;
}

export function isRunStart(v: unknown): v is RunStart {
  if (!isRunChoice(v)) return false;
  const yaku = (v as Partial<RunStart>).unlockedYaku;
  return Array.isArray(yaku) && yaku.every((y) => typeof y === 'string');
}

/** 選んだ雀士と段位を、解禁の状態で選べる範囲に収める（選べない雀士は標準、段位は選べるいちばん上まで） */
export function clampChoice(p: Progress, c: RunChoice): RunChoice {
  return { character: characterUnlocked(p, c.character) ? c.character : 'standard', dan: Math.min(c.dan, maxDan(p)) };
}

/**
 * 解禁の状態から、ランの始めの条件を作る。雀士がまだ選べない、段位が選べる範囲の外なら null。
 * 解禁済みの役は、その時点で和了ったことのある役すべて
 */
export function makeStart(p: Progress, character: string, dan: number): RunStart | null {
  const choice = { character, dan };
  if (!isRunChoice(choice) || !characterUnlocked(p, character) || dan > maxDan(p)) return null;
  return { ...choice, unlockedYaku: [...p.yakuWon].sort() };
}

/** 2 つの始めの条件が同じか（サーバーが渡した条件と、ログの条件を比べる） */
export function sameStart(a: RunStart, b: RunStart): boolean {
  const ya = [...a.unlockedYaku].sort();
  const yb = [...b.unlockedYaku].sort();
  return a.character === b.character && a.dan === b.dan && ya.length === yb.length && ya.every((y, i) => y === yb[i]);
}

/** 雀士と段位から決まる、そのランのルール */
export interface RunRules {
  base: BaseRules;
  targets: number[];
  startMoney: number;
  shopSize: number;
  charms: CharmId[];
  equipment: EquipId[];
}

export function runRulesFor(start: RunChoice): RunRules {
  const c = characterOf(start.character);
  if (!c) throw new Error(`unknown character: ${start.character}`);
  let targetTimes = 1;
  let money = c.money;
  let turns = DEFAULT_BASE_RULES.turns;
  let shopSize = BASE_SHOP_SIZE;
  for (const d of DANS.slice(0, start.dan + 1)) {
    targetTimes = d.targetTimes ?? targetTimes;
    money += d.moneyDelta ?? 0;
    turns += d.turnsDelta ?? 0;
    shopSize = d.shopSize ?? shopSize;
  }
  return {
    base: { ...DEFAULT_BASE_RULES, ...c.base, turns },
    targets: BASE_WAVE_TARGETS.map((t) => t * targetTimes),
    startMoney: Math.max(0, money),
    shopSize,
    charms: [...c.charms],
    equipment: [...c.equipment],
  };
}

/* ---------- 解禁 ---------- */

/** ショップに並べてよいお守りか（unlockYaku のあるお守りは、その役で和了ったことがあるときだけ） */
export function charmAvailable(id: CharmId, unlockedYaku: readonly string[]): boolean {
  const need = CHARMS.find((c) => c.id === id)?.unlockYaku;
  return !need || unlockedYaku.includes(need);
}

/** ショップに並べてよい役の巻物 */
export function scrollYakuAvailable(unlockedYaku: readonly string[]): string[] {
  return SCROLL_YAKU.filter((y) => unlockedYaku.includes(y));
}

/** 2 つの解禁の状態を合わせる（解禁は減らないので、和を取る。backend の upsertProgress も同じ規則） */
export function mergeProgress(a: Progress, b: Progress): Progress {
  return {
    yakuWon: [...new Set([...a.yakuWon, ...b.yakuWon])].sort(),
    bestWaves: Math.max(a.bestWaves, b.bestWaves),
    danCleared: Math.max(a.danCleared, b.danCleared),
  };
}

/** 終わったランを数えた、新しい解禁の状態 */
export function progressAfter(p: Progress, run: RunState): Progress {
  return mergeProgress(p, {
    yakuWon: run.yakuWon,
    bestWaves: runSummary(run).wavesCleared,
    danCleared: run.phase === 'cleared' ? run.start.dan : -1,
  });
}

/** 新しく解禁されたもの（画面に出す） */
export interface NewUnlocks {
  characters: CharacterId[];
  dans: number[];
  /** 役の巻物が並ぶようになった役 */
  scrolls: string[];
  charms: CharmId[];
}

export function newUnlocks(before: Progress, after: Progress): NewUnlocks {
  const scrollsBefore = scrollYakuAvailable(before.yakuWon);
  return {
    characters: CHARACTERS.filter((c) => !c.unlocked(before) && c.unlocked(after)).map((c) => c.id),
    dans: DANS.filter((d) => d.level > maxDan(before) && d.level <= maxDan(after)).map((d) => d.level),
    scrolls: scrollYakuAvailable(after.yakuWon).filter((y) => !scrollsBefore.includes(y)),
    charms: CHARMS.filter((c) => !charmAvailable(c.id, before.yakuWon) && charmAvailable(c.id, after.yakuWon)).map(
      (c) => c.id,
    ),
  };
}
