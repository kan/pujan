/**
 * ローグライトのアイテムとボス。仕様は docs/SPEC.md §4「ローグライト」。
 *
 * アイテムの効果は、局のルールを決める Modifiers への差分として書く。
 * 新しいアイテムは定義を足し、必要なら Modifiers に項目を足して効く場所（win.ts・score.ts・kyoku.ts）で読む。
 */
import type { DoraMode } from './win.js';

/** 設備の上座で、親番の局に足す巡の数 */
export const DEALER_EXTRA_TURNS = 3;
/** 牌の改造の金箔で、1 回に金牌にする枚数 */
export const GOLD_PER_MOD = 2;
/** 和了に使った金牌 1 枚の祝儀 */
export const GOLD_MONEY = 2;

export type CharmId =
  | 'hayazashi'
  | 'yasude'
  | 'damaten'
  | 'ippatsuya'
  | 'bakuchi'
  | 'ura2'
  | 'oyaji'
  | 'isuwari'
  | 'akaito'
  | 'iromegane'
  | 'tobiishi'
  | 'kazamidori'
  | 'hakushi'
  | 'chokin'
  | 'nolimit';
export type EquipId =
  | 'hold'
  | 'next'
  | 'turns'
  | 'dora2'
  | 'joker'
  | 'jokerplus'
  | 'kamiza'
  | 'heijoshin'
  | 'meguri';
export type ConsumableId = 'tsumo' | 'hiroi' | 'nozoki' | 'irekae' | 'some' | 'encho';
export type ModId = 'shu' | 'kin' | 'nuki' | 'utsushi';
export type BossId = 'seal' | 'fog' | 'shibari' | 'short' | 'nobonus';

export interface ItemDef<Id extends string> {
  id: Id;
  name: string;
  description: string;
}

export interface CharmDef extends ItemDef<CharmId> {
  /** ビルドの軸（ショップと持ち物の表示用） */
  axis: string;
  /** 価格。省略時は PRICES.charm */
  price?: number;
  /** この役で一度和了るとショップに並ぶ（省略時は最初から並ぶ。docs/SPEC.md §4.6） */
  unlockYaku?: string;
}

export interface EquipDef extends ItemDef<EquipId> {
  /** 先に持っている必要がある設備 */
  requires?: EquipId;
}

export const CHARMS: readonly CharmDef[] = [
  { id: 'hayazashi', name: '早指し', description: '6巡以内の和了で＋1翻', axis: '速攻' },
  { id: 'yasude', name: '安手の美学', description: '役なしの和了が4倍', axis: '速攻' },
  { id: 'damaten', name: '黙聴', description: '門前が2翻になる', axis: '門前' },
  { id: 'ippatsuya', name: '一発屋', description: 'リーチの次のツモで和了ると＋2翻', axis: 'リーチ' },
  { id: 'bakuchi', name: '博打打ち', description: 'リーチの巡数ボーナス2倍、リーチ棒は300点', axis: 'リーチ' },
  { id: 'ura2', name: '裏の顔', description: '裏ドラ表示が2枚', axis: 'リーチ' },
  { id: 'oyaji', name: '親父の背中', description: '親の倍率が2倍', axis: '親番' },
  { id: 'isuwari', name: '居座り', description: '本場ボーナスが3倍', axis: '親番' },
  { id: 'akaito', name: '赤い糸', description: '赤牌が1枚2翻', axis: '赤ドラ' },
  { id: 'iromegane', name: '色眼鏡', description: '萬子と索子を同じ色として扱う', axis: '言い張り', unlockYaku: '混一色' },
  { id: 'tobiishi', name: '飛び石', description: '147・258・369を順子として扱う', axis: '言い張り', unlockYaku: 'プチ一通' },
  { id: 'kazamidori', name: '風見鶏', description: 'すべての風牌が役牌', axis: '言い張り', unlockYaku: 'プチ小四喜' },
  { id: 'hakushi', name: '白紙委任', description: '白を万能牌として扱う', axis: '役満', unlockYaku: 'プチ小三元' },
  { id: 'chokin', name: '貯金箱', description: '聴牌料が2倍', axis: '保険' },
  { id: 'nolimit', name: '青天井', description: '満貫以上の上限がなくなり、翻ごとに点数が倍になる', axis: 'インフレ', price: 8, unlockYaku: '清一色' },
];

export const EQUIPMENT: readonly EquipDef[] = [
  { id: 'hold', name: '物置', description: '保留枠＋1' },
  { id: 'next', name: '千里眼', description: 'ネクスト＋1' },
  { id: 'turns', name: '長考', description: '1局の巡数＋2' },
  { id: 'dora2', name: '招き猫', description: 'ドラ表示が2枚' },
  { id: 'joker', name: '化け猫', description: 'ドラ牌が万能牌になる（ドラの翻はなくなる）' },
  { id: 'jokerplus', name: '猫に小判', description: '万能牌として使ってもドラの翻が残る', requires: 'joker' },
  { id: 'kamiza', name: '上座', description: `親番の局は巡数＋${DEALER_EXTRA_TURNS}` },
  { id: 'heijoshin', name: '平常心', description: 'リーチが2翻になり、流局してもリーチ棒が戻る' },
  { id: 'meguri', name: '巡り目', description: '891・912を順子として扱う' },
];

/** 延長札で延びる巡の数 */
export const EXTEND_TURNS = 3;

export interface ConsumableDef extends ItemDef<ConsumableId> {
  /** 手を変えないので、リーチ中も使える */
  usableInRiichi?: boolean;
}

export const CONSUMABLES: readonly ConsumableDef[] = [
  { id: 'tsumo', name: 'ツモ直し', description: '今のツモ牌を山の底へ戻して引き直す' },
  { id: 'hiroi', name: '河拾い', description: '最後に捨てた牌をツモ牌として拾う' },
  { id: 'nozoki', name: '山覗き', description: 'この局の間、山の先5枚まで見える' },
  { id: 'irekae', name: '総入れ替え', description: '手牌とツモ牌を山に戻して配り直す（巡は進まない）' },
  { id: 'some', name: '染め粉', description: 'この局だけ、選んだ色（萬子・筒子・索子・字牌）以外の牌を山から半分抜く' },
  {
    id: 'encho',
    name: '延長札',
    description: `最終巡で使うと、この局の巡数＋${EXTEND_TURNS}（1局に1回。リーチ中も使える）`,
    usableInRiichi: true,
  },
];

/** 消耗品の染め粉で選ぶ色（0: 萬子・1: 筒子・2: 索子・3: 字牌。tiles.ts の suit と同じ番号） */
export const SOME_COLORS = ['萬子', '筒子', '索子', '字牌'] as const;

export const MODS: readonly ItemDef<ModId>[] = [
  { id: 'shu', name: '朱塗り', description: '選んだ牌を全部赤牌にする' },
  { id: 'kin', name: '金箔', description: `選んだ牌の${GOLD_PER_MOD}枚を金牌にする（和了に使うと1枚につき祝儀＋${GOLD_MONEY}）` },
  { id: 'nuki', name: '抜き取り', description: '選んだ牌を山から全部抜く' },
  { id: 'utsushi', name: '写し', description: '選んだ牌を5枚に増やす' },
];

/** 役の巻物で強化できる役 */
export const SCROLL_YAKU: readonly string[] = [
  '断么九',
  '役牌',
  '門前',
  '混一色',
  '清一色',
  'プチ三色',
  'プチ一通',
  'プチ小四喜',
  'プチ四暗刻',
  'プチ国士',
  '三対子',
  'プチ小三元',
];

export const BOSSES: readonly ItemDef<BossId>[] = [
  { id: 'seal', name: '保留封印', description: '保留枠が使えない' },
  { id: 'fog', name: '霧', description: 'ネクストが見えない' },
  { id: 'shibari', name: '1翻縛り', description: '役なしでは和了れない（ドラ・赤・門前は役に数えない）' },
  { id: 'short', name: '早仕舞い', description: '巡数が4少ない' },
  { id: 'nobonus', name: '質素倹約', description: 'ドラと赤の翻がつかない' },
];

export const PRICES = { charm: 5, equip: 8, consumable: 3, mod: 3, scroll: 3 } as const;
export const MAX_CHARMS = 5;
export const MAX_CONSUMABLES = 2;
export const REROLL_PRICE = 2;
/** ショップで持ち物を売ったときにもらえる祝儀 */
export const SELL_PRICES = { charm: 2, consumable: 1 } as const;

/** 基本ルールの値（プロトタイプの初期設定） */
export interface BaseRules {
  turns: number;
  holdSlots: number;
  next: number;
  redFives: boolean;
  haitei: boolean;
}

export const DEFAULT_BASE_RULES: BaseRules = { turns: 12, holdSlots: 3, next: 2, redFives: true, haitei: true };

/** 1 局のルール。基本ルールに持ち物とボスを重ねたもの */
export interface Modifiers {
  turns: number;
  holdSlots: number;
  next: number;
  haitei: boolean;
  doraIndicators: number;
  doraMode: DoraMode;
  uraIndicators: number;
  menzenHan: number;
  redHan: number;
  noBonus: boolean;
  shibari: boolean;
  sameColorManSou: boolean;
  skipSequences: boolean;
  allWindsYakuhai: boolean;
  wrapSequences: boolean;
  /** リーチの翻（通常 1、平常心で 2） */
  riichiHan: number;
  /** 流局してもリーチ棒が戻る（平常心） */
  riichiStickBack: boolean;
  hakuJoker: boolean;
  earlyWinBonus: boolean;
  ippatsuHan: number;
  riichiCost: number;
  riichiBonusPerTurn: number;
  dealerMultiplier: number;
  honbaBonus: number;
  tenpaiFee: number;
  cheapHandTimes4: boolean;
  noLimit: boolean;
}

export interface Loadout {
  charms: readonly CharmId[];
  equipment: readonly EquipId[];
}

/** 1 局のルール。dealer は親番の局か（上座の巡数に効く） */
export function modifiersFor(base: BaseRules, loadout: Loadout, boss: BossId | null, dealer = false): Modifiers {
  const has = (id: CharmId) => loadout.charms.includes(id);
  const eq = (id: EquipId) => loadout.equipment.includes(id);
  return {
    turns:
      base.turns +
      (eq('turns') ? 2 : 0) +
      (dealer && eq('kamiza') ? DEALER_EXTRA_TURNS : 0) -
      (boss === 'short' ? 4 : 0),
    holdSlots: boss === 'seal' ? 0 : base.holdSlots + (eq('hold') ? 1 : 0),
    next: boss === 'fog' ? 0 : base.next + (eq('next') ? 1 : 0),
    haitei: base.haitei,
    doraIndicators: eq('dora2') ? 2 : 1,
    doraMode: eq('joker') ? (eq('jokerplus') ? 'jokerPlus' : 'joker') : 'normal',
    uraIndicators: has('ura2') ? 2 : 1,
    menzenHan: has('damaten') ? 2 : 1,
    redHan: has('akaito') ? 2 : 1,
    noBonus: boss === 'nobonus',
    shibari: boss === 'shibari',
    sameColorManSou: has('iromegane'),
    skipSequences: has('tobiishi'),
    allWindsYakuhai: has('kazamidori'),
    wrapSequences: eq('meguri'),
    riichiHan: eq('heijoshin') ? 2 : 1,
    riichiStickBack: eq('heijoshin'),
    hakuJoker: has('hakushi'),
    earlyWinBonus: has('hayazashi'),
    ippatsuHan: has('ippatsuya') ? 2 : 0,
    riichiCost: has('bakuchi') ? 300 : 100,
    riichiBonusPerTurn: has('bakuchi') ? 200 : 100,
    dealerMultiplier: has('oyaji') ? 2 : 1.5,
    honbaBonus: has('isuwari') ? 300 : 100,
    tenpaiFee: has('chokin') ? 400 : 200,
    cheapHandTimes4: has('yasude'),
    noLimit: has('nolimit'),
  };
}
