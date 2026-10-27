/** 画面の文言。言い回しはプロトタイプ（docs/prototype/puchi-mahjong.html）にそろえる */
import {
  BOSSES,
  CHARMS,
  CONSUMABLES,
  EQUIPMENT,
  KYOKU_PER_WAVE,
  MODS,
  type BossId,
  type CharmId,
  type Composition,
  type ConsumableId,
  type EquipId,
  type Kind,
  type Offer,
  type RunState,
} from '@pujan/engine';

export const WIND_NAMES = ['東', '南', '西', '北'] as const;

/* engine の定義を id で引く */
export const charmDef = (id: CharmId) => CHARMS.find((c) => c.id === id)!;
export const equipDef = (id: EquipId) => EQUIPMENT.find((c) => c.id === id)!;
export const consumableDef = (id: ConsumableId) => CONSUMABLES.find((c) => c.id === id)!;
export const bossDef = (id: BossId) => BOSSES.find((c) => c.id === id)!;

/** 局の名前（「東2局 1本場（親）」） */
export function roundLabel(wave: number, kyoku: number, honba: number, dealer: boolean): string {
  return `${WIND_NAMES[wave]}${kyoku + 1}局${honba ? ` ${honba}本場` : ''}${dealer ? '（親）' : ''}`;
}

/** 山にある枚数と赤・金（「4枚・赤1」） */
export function compositionText(c: Composition, k: Kind): string {
  return `${c.count[k]}枚${c.red[k] ? `・赤${c.red[k]}` : ''}${c.gold[k] ? `・金${c.gold[k]}` : ''}`;
}

/** 局の結果のシートの、精算ボタンの文言（オーラスのあとは場の判定、それ以外はショップ） */
export function settleLabel(run: RunState): string {
  return run.round.kyoku >= KYOKU_PER_WAVE - 1 ? '場の結果へ' : 'ショップへ';
}

export const OFFER_TYPE_LABEL: Record<Offer['kind'], string> = {
  charm: 'お守り',
  equip: '設備',
  consumable: '消耗品',
  mod: '牌の改造',
  scroll: '役の巻物',
};

/** ショップの品物の名前と説明。役の巻物は買ったあとのレベルを名前に出す */
export function offerText(o: Offer, yakuLevels: Readonly<Record<string, number>>): { name: string; description: string } {
  switch (o.kind) {
    case 'charm':
      return charmDef(o.id);
    case 'equip':
      return equipDef(o.id);
    case 'consumable':
      return consumableDef(o.id);
    case 'mod':
      return MODS.find((c) => c.id === o.id)!;
    case 'scroll':
      return {
        name: `${o.yaku} Lv${(yakuLevels[o.yaku] ?? 0) + 1}`,
        description: `${o.yaku}を含む和了の点数×1.5（重ねがけ可）`,
      };
  }
}

/** 役表（名前・翻・条件） */
export const YAKU_TABLE: readonly [string, string, string][] = [
  ['リーチ', '1翻', '聴牌で宣言（100点）。以後ツモ切りのみ、ネクストが隠れる。裏ドラあり。宣言から和了までの巡数×100点のボーナス'],
  ['海底', '1翻', '最終巡のツモで和了（設定）'],
  ['ドラ', '1翻/枚', 'ドラ表示の次の牌を使って和了'],
  ['赤', '1翻/枚', '赤牌を使って和了'],
  ['門前', '1翻', '保留牌を使わずに和了（役満以外と複合）'],
  ['プチ国士', '1翻', '三元牌・風牌・1牌・9牌を1枚ずつ＋そのどれかの対子'],
  ['断么九', '1翻', '么九牌を含まない'],
  ['役牌', '1翻〜', '三元牌・場風・自風の対子か刻子。親の局の場風はダブ東などで2翻'],
  ['混一色', '2翻', '数牌1色＋字牌'],
  ['プチ三色', '2翻', '同じ数字の3色＋対子'],
  ['プチ一通', '2翻', '同色の5連（12345など）'],
  ['プチ小四喜', '2翻', '風牌3種＋対子'],
  ['三対子', '2翻', '保留を含めた6枚で対子3組（門前とは両立しない）'],
  ['清一色', '3翻', '数牌1色のみ'],
  ['プチ四暗刻', '3翻', '刻子＋対子'],
  ['プチ小三元', '5翻', '白發中＋対子'],
  ['混老頭', '役満', '么九牌のみで刻子を含む'],
  ['字一色', '役満', '字牌のみ'],
  ['緑一色', '役満', '2・3・4・6・8索と發のみ'],
  ['プチ大四喜', '役満', '東南西北＋三元牌1枚'],
  ['プチ槓', '役満', '同じ牌4枚＋何か1枚'],
  ['天和', '役満', '1巡目のツモで和了'],
  ['地和', '役満', '一度も捨てずに2巡目で和了（保留は可）'],
  ['プチ大三元', 'ダブル役満', '三元牌の刻子＋残りの三元牌1枚ずつ'],
];
