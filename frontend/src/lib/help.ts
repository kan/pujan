/**
 * ヘルプの中身（docs/SPEC.md §6 フェーズ 3.5）: 種類ごとの役表と、組み合わせの役の例、遊び方の説明。
 * 役の例は、その役になることを help.test.ts で engine の役判定に通して確かめる。
 */
import {
  CHUN,
  EAST,
  HAKU,
  HATSU,
  LIMITS,
  NORTH,
  SOUTH,
  WEST,
  YAKUMAN_POINTS,
  man as m,
  pin as p,
  pointsOfHan,
  sou as s,
  type Kind,
} from '@pujan/engine';

export interface YakuHelp {
  name: string;
  han: string;
  condition: string;
  /** 例の手（5 枚、三対子は 6 枚）。場風は東、自風は南として判定する */
  example?: Kind[];
}

export interface YakuTab {
  id: string;
  label: string;
  note?: string;
  rows: YakuHelp[];
}

export const YAKU_TABS: readonly YakuTab[] = [
  {
    id: 'bonus',
    label: 'ボーナス',
    note: 'ボーナスの翻は役に数えません（役なしの手に付いても役なしのまま。ボス「1翻縛り」では和了れません）。',
    rows: [
      { name: 'リーチ', han: '1翻', condition: '聴牌で宣言（100点）。以後ツモ切りのみ、ネクストが隠れる。裏ドラあり。宣言から和了までの巡数×100点のボーナス' },
      { name: '門前', han: '1翻', condition: '保留牌を使わずに和了（役満以外と複合）' },
      { name: 'ドラ', han: '1翻/枚', condition: 'ドラ表示の次の牌を使って和了' },
      { name: '赤', han: '1翻/枚', condition: '赤牌を使って和了' },
      { name: '海底', han: '1翻', condition: '最終巡のツモで和了' },
    ],
  },
  {
    id: 'low',
    label: '1〜2翻',
    rows: [
      { name: '断么九', han: '1翻', condition: '么九牌（1・9・字牌）を含まない', example: [m(2), m(3), m(4), p(6), p(6)] },
      { name: '役牌', han: '1翻〜', condition: '三元牌・場風・自風の対子か刻子＋面子。重なれば加算（親の局の東はダブ東で2翻）', example: [CHUN, CHUN, s(2), s(3), s(4)] },
      { name: 'プチ国士', han: '1翻', condition: '三元牌・風牌・1牌・9牌を1枚ずつ＋そのどれかの対子', example: [HAKU, EAST, m(1), p(9), p(9)] },
      { name: '混一色', han: '2翻', condition: '数牌1色＋字牌', example: [s(1), s(2), s(3), NORTH, NORTH] },
      { name: 'プチ三色', han: '2翻', condition: '同じ数字の3色＋対子', example: [m(3), p(3), s(3), m(7), m(7)] },
      { name: 'プチ一通', han: '2翻', condition: '同色の5連（12345など）。清一色と必ず複合', example: [p(3), p(4), p(5), p(6), p(7)] },
      { name: 'プチ小四喜', han: '2翻', condition: '風牌3種＋対子（何でも可）', example: [EAST, SOUTH, WEST, m(5), m(5)] },
      { name: '三対子', han: '2翻', condition: '保留を含めた6枚で対子3組（門前とは両立しない）', example: [m(2), m(2), p(5), p(5), s(8), s(8)] },
    ],
  },
  {
    id: 'high',
    label: '3翻以上',
    rows: [
      { name: '清一色', han: '3翻', condition: '数牌1色のみ', example: [m(1), m(1), m(2), m(3), m(4)] },
      { name: 'プチ四暗刻', han: '3翻', condition: '刻子＋対子', example: [p(7), p(7), p(7), s(2), s(2)] },
      { name: 'プチ小三元', han: '5翻', condition: '白發中＋対子', example: [HAKU, HATSU, CHUN, m(4), m(4)] },
    ],
  },
  {
    id: 'yakuman',
    label: '役満',
    note: '役満は8,000点。重なれば倍数を足します（プチ大三元はダブル役満）。',
    rows: [
      { name: '混老頭', han: '役満', condition: '么九牌のみで刻子を含む', example: [m(1), m(1), m(1), s(9), s(9)] },
      { name: '字一色', han: '役満', condition: '字牌のみ（プチ大四喜・プチ大三元とは複合しない）', example: [EAST, EAST, EAST, HAKU, HAKU] },
      { name: '緑一色', han: '役満', condition: '2・3・4・6・8索と發のみ', example: [s(2), s(3), s(4), HATSU, HATSU] },
      { name: 'プチ大四喜', han: '役満', condition: '東南西北＋三元牌1枚', example: [EAST, SOUTH, WEST, NORTH, CHUN] },
      { name: 'プチ槓', han: '役満', condition: '同じ牌4枚＋何か1枚', example: [p(5), p(5), p(5), p(5), m(1)] },
      { name: 'プチ大三元', han: 'ダブル役満', condition: '三元牌の刻子＋残りの三元牌1枚ずつ', example: [HAKU, HAKU, HAKU, HATSU, CHUN] },
      { name: '天和', han: '役満', condition: '1巡目のツモで和了' },
      { name: '地和', han: '役満', condition: '一度も捨てずに2巡目で和了（保留は可）' },
    ],
  },
];

const pts = (n: number) => `${n.toLocaleString('ja-JP')}点`;

/** 点数表（翻 → 点数）。engine の点数の定義（score.ts）から作る */
export const SCORE_TABLE: readonly [string, string][] = (() => {
  const rows: [string, string][] = [['役なし', pts(pointsOfHan(0))]];
  // 上限（満貫など）より下は翻ごとに倍
  const firstLimit = Math.min(...LIMITS.map((l) => l.minHan));
  for (let han = 1; han < firstLimit; han++) rows.push([`${han}翻`, pts(pointsOfHan(han))]);
  // 上限は minHan の小さい順に。次の上限の手前までがその上限
  const limits = [...LIMITS].sort((a, b) => a.minHan - b.minHan);
  limits.forEach((l, i) => {
    const next = limits[i + 1];
    const range = !next ? `${l.minHan}翻〜` : next.minHan - 1 === l.minHan ? `${l.minHan}翻` : `${l.minHan}〜${next.minHan - 1}翻`;
    rows.push([`${range}（${l.name}）`, pts(l.points)]);
  });
  rows.push(['役満', pts(YAKUMAN_POINTS)]);
  return rows;
})();
