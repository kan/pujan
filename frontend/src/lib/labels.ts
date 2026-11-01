/** 画面の文言。言い回しはプロトタイプ（docs/prototype/puchi-mahjong.html）にそろえる */
import {
  BOSSES,
  CHARMS,
  CONSUMABLES,
  EQUIPMENT,
  GACHA,
  MAX_CHARMS,
  innateCharms,
  isOrasu,
  missionLabel,
  missionMet,
  missionProgressOf,
  missionText,
  orasuNeed,
  OFFER_KIND_LABEL,
  MODS,
  ALL_KINDS,
  characterName,
  defaultComposition,
  danName,
  startLabel,
  timesLabel,
  type Mission,
  type NewUnlocks,
  type BossId,
  type CharmId,
  type Composition,
  type ConsumableId,
  type EquipId,
  type Kind,
  type Offer,
  type RunState,
  type RecordedSummary,
} from '@pujan/engine';

// 雀士・段位とお題の書き方は engine にある（プレイの集計と同じ書き方にするため。品の種類の名前は OFFER_KIND_LABEL）
export { missionLabel, missionText, startLabel, timesLabel };

/* engine の定義を id で引く */
export const charmDef = (id: CharmId) => CHARMS.find((c) => c.id === id)!;
export const equipDef = (id: EquipId) => EQUIPMENT.find((c) => c.id === id)!;
export const consumableDef = (id: ConsumableId) => CONSUMABLES.find((c) => c.id === id)!;
export const bossDef = (id: BossId) => BOSSES.find((c) => c.id === id)!;

/** お守りの枠（「お守り 2/5（＋固有 1）」）。固有のお守りは枠に数えないので、別に書く */
export function charmSlotText(run: RunState): string {
  const innate = innateCharms(run).length;
  return `お守り ${run.charms.length}/${MAX_CHARMS}${innate ? `（＋固有 ${innate}）` : ''}`;
}

/** 福引きの説明（ショップとヘルプで同じ文を使う） */
export const GACHA_TEXT = `祝儀${GACHA.price}で、${(Object.keys(GACHA.weights) as (keyof typeof GACHA.weights)[])
  .map((k) => OFFER_KIND_LABEL[k])
  .join('・')}のどれかが当たる（牌の改造は出ない）。はずれ（${GACHA.missRate * 100}%）は祝儀${GACHA.missRefund}が戻る`;

/** お題の説明（ヘルプとチュートリアルで同じ文を使う。docs/SPEC.md §4.1） */
export const MISSION_TEXT =
  'ランごとにお題が3つ出る（和了の回数・4局の合計点・特定の役での和了。役のお題は、それより難しい役で和了ってもよい）。東4局を終えたときに1つ以上果たしていればクリア。お題には倍率があり、クリアすると、果たしたお題の倍率の合計を4局の合計点に掛けた点数が記録になる';

/** お題の進み具合（「2/3 回」「4,200/6,000点」「済」）と、果たしたか（判定は engine の missionMet） */
export function missionProgress(run: RunState, m: Mission): { text: string; done: boolean; ratio: number } {
  const p = missionProgressOf(run);
  const done = missionMet(m, p);
  switch (m.kind) {
    case 'wins':
      return { text: `${Math.min(p.wins, m.need)}/${m.need} 回`, done, ratio: Math.min(1, p.wins / m.need) };
    case 'points':
      return {
        text: `${p.points.toLocaleString()}/${m.need.toLocaleString()}点`,
        done,
        ratio: Math.max(0, Math.min(1, p.points / m.need)),
      };
    case 'yaku':
      return { text: done ? '済' : '未', done, ratio: done ? 1 : 0 };
  }
}

/**
 * 段位の縛りで要る、オーラスの和了の条件（「オーラスで和了らないとクリアになりません」）。条件がなければ空
 */
export function orasuRuleText(run: RunState): string {
  const need = orasuNeed(run);
  if (need === null) return '';
  return need <= 1
    ? 'オーラスで和了らないとクリアになりません'
    : `オーラスで${need.toLocaleString()}点以上の和了がないとクリアになりません`;
}

/** もらった品（福引き）の名前と説明。役の巻物はもう受け取ったので、受け取る前のレベルから名前を作る */
export function receivedText(p: Offer, yakuLevels: Readonly<Record<string, number>>): { name: string; description: string } {
  const before = p.kind === 'scroll' ? { ...yakuLevels, [p.yaku]: (yakuLevels[p.yaku] ?? 1) - 1 } : yakuLevels;
  return offerText(p, before);
}

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
export function roundLabel(kyoku: number, honba: number, dealer: boolean): string {
  return `東${kyoku + 1}局${honba ? ` ${honba}本場` : ''}${dealer ? '（親）' : ''}`;
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

/**
 * ランの成績（「クリア（お題 2/3・×2.5）・記録15,500点」「未達・合計6,200点」）。
 * お題がないのは 4 場の形で記録したランキングの行
 */
export function summaryText(s: RecordedSummary): string {
  if (!s.missions) return `前の形（4場）の記録・合計${s.totalScore.toLocaleString()}点`;
  const met = s.missions.filter((m) => m.met).length;
  return s.cleared
    ? `クリア（お題 ${met}/${s.missions.length}・${timesLabel(s.times)}）・記録${s.recordScore.toLocaleString()}点`
    : `未達・合計${s.totalScore.toLocaleString()}点`;
}

/** 局の結果のシートの、精算ボタンの文言（オーラスのあとはランの結果、それ以外はショップ） */
export function settleLabel(run: RunState): string {
  return isOrasu(run) ? 'ランの結果へ' : 'ショップへ';
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
