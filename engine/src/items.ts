/**
 * ローグライトのアイテムとボス。仕様は docs/SPEC.md §4「ローグライト」。
 *
 * アイテムの効果は、局のルールを決める Modifiers への差分として書く。
 * 新しいアイテムは定義を足し、必要なら Modifiers に項目を足して効く場所（win.ts・score.ts・kyoku.ts）で読む。
 */
import type { DoraMode } from './win.js';

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
export type EquipId = 'hold' | 'next' | 'turns' | 'dora2' | 'joker' | 'jokerplus';
export type ConsumableId = 'tsumo' | 'hiroi' | 'nozoki' | 'irekae';
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
];

export const CONSUMABLES: readonly ItemDef<ConsumableId>[] = [
  { id: 'tsumo', name: 'ツモ直し', description: '今のツモ牌を山の底へ戻して引き直す' },
  { id: 'hiroi', name: '河拾い', description: '最後に捨てた牌をツモ牌として拾う' },
  { id: 'nozoki', name: '山覗き', description: 'この局の間、山の先5枚まで見える' },
  { id: 'irekae', name: '総入れ替え', description: '手牌とツモ牌を山に戻して配り直す（巡は進まない）' },
];

export const MODS: readonly ItemDef<ModId>[] = [
  { id: 'shu', name: '朱塗り', description: '選んだ牌の2枚を赤牌にする' },
  { id: 'kin', name: '金箔', description: '選んだ牌の1枚を金牌にする（和了に使うと祝儀＋2）' },
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
export const SELL_PRICE = 2;

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

export function modifiersFor(base: BaseRules, loadout: Loadout, boss: BossId | null): Modifiers {
  const has = (id: CharmId) => loadout.charms.includes(id);
  const eq = (id: EquipId) => loadout.equipment.includes(id);
  return {
    turns: base.turns + (eq('turns') ? 2 : 0) - (boss === 'short' ? 4 : 0),
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
