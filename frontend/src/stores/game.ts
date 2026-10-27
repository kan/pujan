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
  finalizeContext,
  finalizeScore,
  isActing,
  isJoker,
  newLog,
  remainingOf,
  replay,
  visibleNext,
  type BaseRules,
  type ConsumableId,
  type GameAction,
  type GameState,
  type Kind,
  type RunLog,
  type Zone,
} from '@pujan/engine';
import { browserStorage, clearRunLog, loadRules, loadRunLog, saveRules, saveRunLog } from '@/lib/storage';

export interface Selection {
  zone: Zone;
  index: number;
}

/** 0〜2^31-1 のシード */
function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] >>> 1;
}

export const useGameStore = defineStore('game', () => {
  const storage = browserStorage();
  const rules = ref<BaseRules>(loadRules(storage));
  const log = shallowRef<RunLog>(newLog(0, rules.value));
  // engine の状態は書き換えずに作り直すので、深い追跡はいらない
  const game = shallowRef<GameState>(createGame(0, rules.value));
  const selection = ref<Selection | null>(null);
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

  function startRun(seed = randomSeed()) {
    log.value = newLog(seed, rules.value);
    game.value = createGame(seed, rules.value);
    dismissedAt.value = -1;
    saveRunLog(storage, log.value);
    selectDefault();
  }

  /** 保存してある途中のランを読み込む。なければ（再生できなければ）新しいランを始める */
  function init() {
    const saved = loadRunLog(storage);
    if (saved) {
      try {
        game.value = replay(saved);
        log.value = saved;
        selectDefault();
        return;
      } catch (e) {
        // engine の版が変わった、壊れているなど。続きは遊べないので新しく始める
        console.warn('saved run could not be replayed', e);
        clearRunLog(storage);
      }
    }
    startRun();
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
  const winPreview = computed(() => {
    const k = kyoku.value;
    if (!acting.value || !k?.win) return null;
    const score = finalizeScore(k.win.evaluation, finalizeContext(k));
    const names = score.lines.filter((l) => l.kind === 'yaku').map((l) => l.label);
    return { names, points: score.points, tileIds: new Set(k.win.tileIds) };
  });

  /** 待ち牌と残り枚数（null は万能牌が多くて数えていない） */
  const waitsInfo = computed(() => {
    const k = kyoku.value;
    if (!k || !k.waits) return [];
    return k.waits.map((kind) => ({ kind, remaining: remainingOf(k, kind) }));
  });

  const nextTiles = computed(() => (kyoku.value ? visibleNext(kyoku.value) : []));

  const jokerOf = (kind: Kind) => !!kyoku.value && isJoker(kyoku.value, kind);

  const consumableUsable = (id: ConsumableId) => !!kyoku.value && canUseConsumable(kyoku.value, id);

  /* ---------- ルール設定 ---------- */

  function applyRules(next: BaseRules) {
    rules.value = next;
    saveRules(storage, next);
    startRun();
  }

  return {
    rules,
    log,
    game,
    run,
    kyoku,
    shownKyoku,
    selection,
    showIntro,
    showWaveResult,
    acting,
    canHold,
    canRiichiSelected,
    canRedealNow,
    winPreview,
    waitsInfo,
    nextTiles,
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
    applyRules,
  };
});
