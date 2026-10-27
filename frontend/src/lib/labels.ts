/** 画面の文言。言い回しはプロトタイプ（docs/prototype/puchi-mahjong.html）にそろえる */
import {
  BOSSES,
  CHARMS,
  CONSUMABLES,
  EQUIPMENT,
  KYOKU_PER_WAVE,
  MODS,
  WAVE_COUNT,
  characterName,
  danName,
  type NewUnlocks,
  type BossId,
  type CharmId,
  type Composition,
  type ConsumableId,
  type EquipId,
  type Kind,
  type Offer,
  type RunState,
  type RunSummary,
} from '@pujan/engine';

export const WIND_NAMES = ['東', '南', '西', '北'] as const;

/* engine の定義を id で引く */
export const charmDef = (id: CharmId) => CHARMS.find((c) => c.id === id)!;
export const equipDef = (id: EquipId) => EQUIPMENT.find((c) => c.id === id)!;
export const consumableDef = (id: ConsumableId) => CONSUMABLES.find((c) => c.id === id)!;
export const bossDef = (id: BossId) => BOSSES.find((c) => c.id === id)!;

/** 雀士と段位（「うさぎ・二段」）。ランキングや場の案内に出す */
export const startLabel = (s: { character: string; dan: number }) => `${characterName(s.character)}・${danName(s.dan)}`;

/** 新しく解禁されたものを 1 行ずつ（「雀士「うさぎ」」「役の巻物「混一色」」） */
export function unlockLines(u: NewUnlocks): string[] {
  return [
    ...u.characters.map((id) => `雀士「${characterName(id)}」`),
    ...u.dans.map((d) => `段位「${danName(d)}」`),
    ...u.scrolls.map((y) => `役の巻物「${y}」がショップに並ぶ`),
    ...u.charms.map((id) => `お守り「${charmDef(id).name}」がショップに並ぶ`),
  ];
}

/** 局の名前（「東2局 1本場（親）」） */
export function roundLabel(wave: number, kyoku: number, honba: number, dealer: boolean): string {
  return `${WIND_NAMES[wave]}${kyoku + 1}局${honba ? ` ${honba}本場` : ''}${dealer ? '（親）' : ''}`;
}

/** 山にある枚数と赤・金（「4枚・赤1」） */
export function compositionText(c: Composition, k: Kind): string {
  return `${c.count[k]}枚${c.red[k] ? `・赤${c.red[k]}` : ''}${c.gold[k] ? `・金${c.gold[k]}` : ''}`;
}

/** ランの成績（「2場突破・合計3,000点」「全場クリア・合計…」） */
export function summaryText(s: RunSummary): string {
  return `${s.wavesCleared >= WAVE_COUNT ? '全場クリア' : `${s.wavesCleared}場突破`}・合計${s.totalScore.toLocaleString()}点`;
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
