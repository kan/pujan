/**
 * ランの状態（docs/SPEC.md §6 フェーズ 2）。
 *
 * engine の GameState を持ち、プレイヤーの操作はすべて apply() に通して操作ログ（RunLog）に積む。
 * 操作のたびにログを localStorage に保存し、開き直したときは replay() で同じ状態を作り直す。
 * ゲームのルールはここに書かない（engine に問い合わせる）。ここが持つのは、選んでいる牌などの画面の状態だけ。
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import {
  apply,
  canRedeal,
  canRiichi,
  canUseConsumable,
  createGame,
  ENGINE_VERSION,
  isActing,
  isFinished,
  clampChoice,
  isJoker,
  isRunStart,
  makeStart,
  newLog,
  randomSeed,
  remainingOf,
  replay,
  type ConsumableId,
  type GameAction,
  type GameState,
  type Kind,
  type NewUnlocks,
  type RunChoice,
  type RunLog,
  type Zone,
} from '@pujan/engine';
import {
  browserStorage,
  clearRunLog,
  loadChoice,
  loadRunId,
  loadRunLog,
  saveChoice,
  saveRunId,
  saveRunLog,
} from '@/lib/storage';
import { winPreviewOf } from '@/lib/win-preview';
import { useAccountStore } from './account';

export interface Selection {
  zone: Zone;
  index: number;
}

export const useGameStore = defineStore('game', () => {
  const storage = browserStorage();
  const log = shallowRef<RunLog>(newLog(0));
  // engine の状態は書き換えずに作り直すので、深い追跡はいらない
  const game = shallowRef<GameState>(createGame(0));
  const account = useAccountStore();
  const selection = ref<Selection | null>(null);
  /** ランキングに載せるランの、サーバーのランの ID（端末だけのランでは null） */
  const runId = ref<string | null>(null);
  /** 新しいランを始めている途中（サーバーにシードをもらっている） */
  const starting = ref(false);
  /** 終わったランで新しく解禁されたもの（ラン終了のシートに出す。開き直したあとは null） */
  const unlocks = shallowRef<NewUnlocks | null>(null);
  /**
   * 場の案内や場の結果を閉じたときの操作の数。操作が進めば古くなるので、次の場ではまた出る。
   * 保存はしない（開き直したときに、まだ何もしていなければもう一度出る）
   */
  const dismissedAt = ref(-1);

  const run = computed(() => game.value.run);
  const kyoku = computed(() => game.value.kyoku);
  /** 画面に出す局。精算してショップなどに移ったあとも、直前の局を後ろに出しておく */
  const shownKyoku = computed(() => kyoku.value ?? game.value.previous);
  /** 牌を選んで操作できる（ツモ牌があり、局が終わっていない） */
  const acting = computed(() => !!kyoku.value && isActing(kyoku.value));

  const lastAction = computed(() => log.value.actions.at(-1));
  const dismissed = computed(() => dismissedAt.value === log.value.actions.length);

  /** 場の案内: 場の最初の局を、まだ何もせずに始めるところ（ランの始めか、ショップを出て次の場に入った直後） */
  const showIntro = computed(() => {
    const r = run.value;
    const entered = !lastAction.value || lastAction.value.type === 'leave';
    const fresh = r.phase === 'kyoku' && r.round.kyoku === 0 && r.round.honba === 0 && !r.round.log.length;
    return entered && fresh && !dismissed.value;
  });

  /** 場の結果（突破）: 場を突破した精算の直後。ショップで何かしたあとは出さない */
  const showWaveResult = computed(
    () =>
      run.value.phase === 'shop' && run.value.afterShop === 'nextWave' && lastAction.value?.type === 'settle' && !dismissed.value,
  );

  /** 場の案内・場の結果を閉じる */
  function dismiss() {
    dismissedAt.value = log.value.actions.length;
  }

  function selectDefault() {
    selection.value = acting.value ? { zone: 'drawn', index: 0 } : null;
  }

  /**
   * 新しいランを始める。サーバーにシードをもらってランキングに載せるランにする
   * （良い山を手元で探す不正を防ぐため、シードはサーバーが決める。docs/SPEC.md §5.3）。
   * サーバーにつながらないときは、端末で決めたシードの端末だけのランになる。
   * 雀士と段位は choice（省略時は前のランで選んだもの）。解禁済みの役は、ランキングに載るランではサーバーの記録、
   * 端末だけのランでは端末の記録から決める
   */
  async function startRun(choice: RunChoice = loadChoice(storage)) {
    if (starting.value) return;
    starting.value = true;
    try {
      saveChoice(storage, choice);
      const ranked = await account.startRankedRun(choice);
      // 版が違う・始めの条件の形が違うランは、ランキングに載せずに端末だけのランにする
      const usable = ranked && ranked.engineVersion === ENGINE_VERSION && isRunStart(ranked.start) ? ranked : null;
      const seed = usable?.seed ?? randomSeed();
      let start = usable?.start;
      if (!start) {
        // 端末だけのラン: サーバーの解禁を足してから、端末の記録でも選べない組み合わせを選べる範囲に収める
        await account.whenMeLoaded();
        const local = clampChoice(account.progress, choice);
        start = makeStart(account.progress, local.character, local.dan)!;
      }
      log.value = newLog(seed, start);
      game.value = createGame(seed, { start });
      runId.value = usable?.id ?? null;
      unlocks.value = null;
      dismissedAt.value = -1;
      account.clearSubmission();
      saveRunLog(storage, log.value);
      saveRunId(storage, runId.value);
      selectDefault();
    } finally {
      starting.value = false;
    }
  }

  /** 保存してある途中のランを読み込む。なければ（再生できなければ）新しいランを始める */
  async function init() {
    void account.loadMe();
    const saved = loadRunLog(storage);
    if (saved) {
      try {
        game.value = replay(saved);
        log.value = saved;
        runId.value = loadRunId(storage);
        selectDefault();
        // 終わったランの結果の画面で開き直した: 記録をもう一度送る（記録済みなら同じ成績が返る）。
        // submit が送り直し待ちから同じランを外すので、flushPending より先に呼ぶ
        if (isFinished(game.value)) void account.submit(runId.value, log.value);
        void account.flushPending();
        return;
      } catch (e) {
        // engine の版が変わった、壊れているなど。続きは遊べないので新しく始める
        console.warn('saved run could not be replayed', e);
        clearRunLog(storage);
      }
    }
    void account.flushPending();
    await startRun();
  }

  /** 操作を適用し、ログに積んで保存する。できない操作なら false */
  function act(action: GameAction): boolean {
    try {
      game.value = apply(game.value, action);
    } catch (e) {
      console.warn('action rejected', action, e);
      return false;
    }
    log.value = { ...log.value, actions: [...log.value.actions, action] };
    saveRunLog(storage, log.value);
    selectDefault();
    // ランが終わった（ラン終了・全場クリア）: 解禁を数え、記録を送る
    if (isFinished(game.value)) {
      unlocks.value = account.countFinishedRun(game.value.run);
      void account.submit(runId.value, log.value);
    }
    return true;
  }

  /* ---------- 局の操作 ---------- */

  /** 牌をタップ: 選ぶ。選んでいる牌をもう一度タップすると捨てる（ツモのたびにツモ牌を選んだ状態にする） */
  function tapTile(zone: Zone, index: number) {
    if (!acting.value) return;
    if (kyoku.value!.riichi && zone !== 'drawn') return;
    const sel = selection.value;
    if (sel && sel.zone === zone && sel.index === index) act({ type: 'discard', zone, index });
    else selection.value = { zone, index };
  }

  /** 選んでいる牌（手牌かツモ牌）を保留できる */
  const canHold = computed(() => {
    const sel = selection.value;
    return acting.value && !kyoku.value!.riichi && !!sel && sel.zone !== 'hold' && kyoku.value!.hold.includes(null);
  });

  /** 空いた保留枠をタップ: 選んでいる牌を保留する */
  function tapSlot(slot: number) {
    const sel = selection.value;
    if (canHold.value && sel && sel.zone !== 'hold') act({ type: 'hold', zone: sel.zone, index: sel.index, slot });
  }

  function holdSelected() {
    if (kyoku.value) tapSlot(kyoku.value.hold.indexOf(null));
  }

  const canRiichiSelected = computed(() => {
    const sel = selection.value;
    return acting.value && !!sel && canRiichi(kyoku.value!, sel.zone, sel.index);
  });

  function riichiSelected() {
    const sel = selection.value;
    if (sel && canRiichiSelected.value) act({ type: 'riichi', zone: sel.zone, index: sel.index });
  }

  const canRedealNow = computed(() => !!kyoku.value && canRedeal(kyoku.value));

  /** 今のツモで和了れるときの役と点数（親・本場などを掛けたあと） */
  const winPreview = computed(() => winPreviewOf(kyoku.value));

  /** 待ち牌と残り枚数（null は万能牌が多くて数えていない） */
  const waitsInfo = computed(() => {
    const k = kyoku.value;
    if (!k || !k.waits) return [];
    return k.waits.map((kind) => ({ kind, remaining: remainingOf(k, kind) }));
  });

  const jokerOf = (kind: Kind) => !!kyoku.value && isJoker(kyoku.value, kind);

  const consumableUsable = (id: ConsumableId) => !!kyoku.value && canUseConsumable(kyoku.value, id);

  return {
    log,
    game,
    run,
    kyoku,
    shownKyoku,
    selection,
    runId,
    starting,
    unlocks,
    showIntro,
    showWaveResult,
    acting,
    canHold,
    canRiichiSelected,
    canRedealNow,
    winPreview,
    waitsInfo,
    init,
    startRun,
    act,
    dismiss,
    tapTile,
    tapSlot,
    holdSelected,
    riichiSelected,
    jokerOf,
    consumableUsable,
  };
});
