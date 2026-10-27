/**
 * チュートリアル（docs/SPEC.md §6 フェーズ 3.5）。山の並びを決めた練習の局で、捨てる・保留する・ネクストを見る・和了るを
 * 実際に操作してもらう（TAKO-SEN のチュートリアルと同じく、言われた操作ができたら次へ進む）。
 * そのあとランの流れを説明する。局の進行は engine の step() に任せ、ここは筋書きと「言われた操作か」の判定だけを持つ。
 */
import {
  DEFAULT_BASE_RULES,
  EAST,
  SOUTH,
  BASE_WAVE_TARGETS,
  CHARACTERS,
  CHUN,
  characterName,
  DANS,
  KYOKU_PER_WAVE,
  WAVE_COUNT,
  createRng,
  defaultComposition,
  man as m,
  modifiersFor,
  sou as s,
  startKyoku,
  type KyokuMove,
  type KyokuState,
  type Kind,
  type Zone,
} from '@pujan/engine';

/**
 * 筋書き（場風は東、自風は南）。配牌 3萬 4萬 9索 東。
 * 南を捨てる → 中を保留 → 東を引き、次の 5萬 が見えるので 9索 を捨てる → 5萬 を引いて 345萬＋東東 で和了
 * （混一色・役牌・門前の 4翻 1,600点）。
 */
export function tutorialKyoku(): KyokuState {
  return startKyoku(
    {
      rng: createRng(1),
      composition: defaultComposition(DEFAULT_BASE_RULES.redFives),
      mods: modifiersFor(DEFAULT_BASE_RULES, { charms: [], equipment: [] }, null),
      bakaze: EAST,
      seat: SOUTH,
      dealer: false,
      honba: 0,
      yakuLevels: {},
    },
    { indicators: [s(9)], hand: [m(3), m(4), s(9), EAST], draws: [SOUTH, CHUN, EAST, m(5)] },
  );
}

export interface PlayStep {
  title: string;
  /** 何をすればよいか */
  instruction: string;
  /** してもらう操作: その牌を捨てる・その牌を保留する・和了る */
  action: 'discard' | 'hold' | 'tsumo';
  /** 捨てる・保留する牌の種類 */
  tile?: Kind;
  /** 言われた操作でなかったときの案内 */
  hint: string;
}

/** その場所の牌の種類（手牌・ツモ牌・保留枠の index 番目。なければ null） */
export function kindAt(k: KyokuState, at: { zone: Zone; index: number } | null): Kind | null {
  if (!at) return null;
  const list = at.zone === 'hand' ? k.hand : at.zone === 'drawn' ? k.drawn : k.hold;
  return list[at.index]?.kind ?? null;
}

/** その操作で手放す（捨てる・保留する）牌の種類 */
function movedKind(move: KyokuMove, k: KyokuState): Kind | null {
  return move.type === 'discard' || move.type === 'hold' ? kindAt(k, move) : null;
}

/** 言われた操作か（違えば hint を出して、局を進めない） */
export function isExpectedMove(st: PlayStep, move: KyokuMove, k: KyokuState): boolean {
  if (move.type !== st.action) return false;
  return st.action === 'tsumo' || movedKind(move, k) === st.tile;
}

/**
 * 次に押すところ（画面で光らせる）。牌を選ぶ前はその牌、選んだあとは同じ牌（捨てる）か空き枠と「保留」ボタン（保留する）、
 * 和了るときは「和了」ボタン。
 */
export type TutorialTarget = { tile: Kind } | { slot: true } | { button: 'tsumo' };

export function nextTarget(st: PlayStep, selectedKind: Kind | null): TutorialTarget {
  if (st.action === 'tsumo') return { button: 'tsumo' };
  if (st.action === 'hold' && selectedKind === st.tile) return { slot: true };
  return { tile: st.tile! };
}

export const PLAY_STEPS: readonly PlayStep[] = [
  {
    title: '牌を捨てよう',
    instruction:
      '手牌は4枚で、毎巡1枚ツモります（右端の少し離れた牌）。ツモ牌は選ばれた状態（少し浮いた状態）です。選んでいる牌をもう一度タップすると捨てます。使い道のない「南」を捨てましょう。',
    action: 'discard',
    tile: SOUTH,
    hint: '「南」をタップして選び、もう一度タップすると捨てます。',
  },
  {
    title: '保留枠に置こう',
    instruction:
      '保留枠に置いた牌は、手牌とは別に取っておけて、和了にも使えます。「中」は役牌になるかもしれないので取っておきましょう。「中」を選んだまま、空いた保留枠をタップします（下の「保留」ボタンでも置けます）。',
    action: 'hold',
    tile: CHUN,
    hint: '「中」を選んだまま、点線の空き枠をタップしましょう。',
  },
  {
    title: 'ネクストを見よう',
    instruction:
      '「東」を引いて、手牌の東と対子になりました。右上の「次」は、これからツモる牌です（左が次）。次に「5萬」が来るのが見えています。3萬・4萬・5萬で順子ができるので、いらない「9索」を捨てて待ちましょう。',
    action: 'discard',
    tile: s(9),
    hint: '手牌の「9索」を選んで、もう一度タップして捨てましょう。',
  },
  {
    title: '和了ろう',
    instruction:
      '5萬が来て、対子（東東）＋面子（3萬4萬5萬）の5枚がそろいました。和了れるときは使う牌が金の枠で光り、中央に役と点数が出ます。「和了」ボタンを押しましょう。',
    action: 'tsumo',
    hint: '下の「和了」ボタンを押しましょう。',
  },
];

/** 説明に出す数字（engine の既定のルールから。数字を変えたら説明も変わる） */
const RULES = modifiersFor(DEFAULT_BASE_RULES, { charms: [], equipment: [] }, null);
const targetsText = BASE_WAVE_TARGETS.map((t, i) => `${['東', '南', '西', '北'][i]}${t.toLocaleString('ja-JP')}`).join('・');

/** 和了ったあとに読んでもらう、ランの流れの説明 */
export const GUIDE_PAGES: readonly { title: string; body: string[]; /** 「役と遊び方」の遊び方のタブにも出す */ inHelp?: boolean }[] = [
  {
    title: '和了の点数',
    body: [
      '萬子と字牌だけなので「混一色」（2翻）、東は場風なので「役牌」（1翻）、保留牌を使わずに和了ったので「門前」（1翻）で、合わせて4翻・1,600点です。役がなくても100点で和了れますが、翻が1つ増えるごとに点数は倍になります（5翻で満貫2,000点）。',
      '保留牌を使って和了ると門前は付きません。保留を使って早く和了るか、使わずに翻を稼ぐかを選びましょう。',
    ],
  },
  {
    title: 'ランの流れ',
    inHelp: true,
    body: [
      `東・南・西・北の${WAVE_COUNT}つの場を勝ち抜けばクリアです。1つの場は${KYOKU_PER_WAVE}局で、${KYOKU_PER_WAVE}局の点数の合計が場の目標点（${targetsText}点）に届けば次の場へ進めます。`,
      `1局は${RULES.turns}巡で、和了れるのは1回だけ。${RULES.turns}巡で和了れなければ流局です（聴牌していれば聴牌料${RULES.tenpaiFee}点）。`,
      `${KYOKU_PER_WAVE}局のうち1局は親番です。親の和了は${RULES.dealerMultiplier}倍で、連荘すると同じ局をもう一度遊べます。`,
    ],
  },
  {
    title: 'ボスとショップ',
    inHelp: true,
    body: [
      '各場の4局目（オーラス）にはボスがいて、「保留枠が使えない」「ネクストが見えない」などの縛りが付きます。場の始めに分かるので、それまでに点数を稼いでおきましょう。',
      '和了ると祝儀（お金）がもらえます。局が終わるたびにショップが開き、祝儀でお守り・設備・消耗品・牌の改造・役の巻物を買えます。組み合わせて点数を伸ばしましょう。',
    ],
  },
  {
    title: '雀士・段位・解禁',
    inHelp: true,
    body: [
      `ランを始めるときに雀士と段位を選べます。雀士（${CHARACTERS.map((c) => characterName(c.id)).join('・')}）は保留枠やネクスト、始めの持ち物が違います。はじめは「${characterName(CHARACTERS[0].id)}」だけで、場を突破したり特定の役で和了ったりすると選べるようになります。`,
      `段位（${DANS[0].name}〜${DANS[DANS.length - 1].name}）は上がるほど目標点などの縛りが重くなります。全場クリアすると次の段位を選べます。ランキングは段位の高い記録が上です。`,
      'その役で一度和了ると、その役の巻物がショップに並ぶようになります。役に結び付いたお守り（色眼鏡・飛び石など）も同じです。',
    ],
  },
  {
    title: 'さあ、始めよう',
    body: [
      '役の一覧や点数表、アイテムの説明は、メニューの「役と遊び方」でいつでも見られます。このチュートリアルもメニューからもう一度開けます。',
      'ランを終えると、その週のランキングに記録が載ります（名前の登録が要ります）。',
    ],
  },
];
