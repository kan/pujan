/** 画面の文言。言い回しはプロトタイプ（docs/prototype/puchi-mahjong.html）にそろえる */
import {
  BOSSES,
  CHARMS,
  CONSUMABLES,
  EQUIPMENT,
  KYOKU_PER_WAVE,
  MODS,
  WAVE_COUNT,
  WIND_NAMES,
  ALL_KINDS,
  characterName,
  defaultComposition,
  danName,
  startLabel,
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

// 場の名前と雀士・段位の書き方は engine にある（プレイの集計と同じ書き方にするため。品の種類の名前は OFFER_KIND_LABEL）
export { WIND_NAMES, startLabel };

/* engine の定義を id で引く */
export const charmDef = (id: CharmId) => CHARMS.find((c) => c.id === id)!;
export const equipDef = (id: EquipId) => EQUIPMENT.find((c) => c.id === id)!;
export const consumableDef = (id: ConsumableId) => CONSUMABLES.find((c) => c.id === id)!;
export const bossDef = (id: BossId) => BOSSES.find((c) => c.id === id)!;

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

/** 牌の改造で、ランを始めたときの山から枚数・赤・金のどれかが変わった牌 */
export function modifiedKinds(run: RunState): Set<Kind> {
  const c = run.composition;
  const d = defaultComposition(run.base.redFives);
  return new Set(ALL_KINDS.filter((k) => c.count[k] !== d.count[k] || c.red[k] !== d.red[k] || c.gold[k] !== d.gold[k]));
}

/** ランの成績（「2場突破・合計3,000点」「全場クリア・合計…」） */
export function summaryText(s: RunSummary): string {
  return `${s.wavesCleared >= WAVE_COUNT ? '全場クリア' : `${s.wavesCleared}場突破`}・合計${s.totalScore.toLocaleString()}点`;
}

/** 局の結果のシートの、精算ボタンの文言（オーラスのあとは場の判定、それ以外はショップ） */
export function settleLabel(run: RunState): string {
  return run.round.kyoku >= KYOKU_PER_WAVE - 1 ? '場の結果へ' : 'ショップへ';
}

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
