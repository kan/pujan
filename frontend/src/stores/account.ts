/**
 * サーバーとのやりとり（docs/SPEC.md §5.3・§5.4）: ランキングに出す名前、ランの開始と記録、週ごとのランキング。
 *
 * ランキングに載るのは、サーバーが渡したシードで始めたランだけ。サーバーにつながらないときは端末だけのランになる
 * （遊べるが記録しない）。終わったランの記録が送れなかったら端末に残し、次に開いたときなどに送り直す。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  ENGINE_VERSION,
  mergeProgress,
  newUnlocks,
  progressAfter,
  type NewUnlocks,
  type Progress,
  type RunChoice,
  type RunLog,
  type RunState,
} from '@pujan/engine';
import { api, ApiError, ensureId, type FinishedRun } from '@/api/client';
import {
  browserStorage,
  loadPending,
  loadProgress,
  loadSettledRunId,
  savePending,
  saveProgress,
  saveSettledRunId,
} from '@/lib/storage';

/** 今のランの記録の様子（ラン終了のシートに出す） */
export type Submission =
  /** 端末だけのラン（始めたときにサーバーにつながらなかった） */
  | { status: 'local' }
  | { status: 'sending' }
  | { status: 'recorded'; result: FinishedRun }
  /** 送れなかった。端末に残して、あとで送り直す */
  | { status: 'queued' }
  /** サーバーが受け付けなかった（新しいランを始めたあと、版の違いなど） */
  | { status: 'rejected'; code: string };

/** つながらないなどで失敗したら null */
const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/** 送り直せば通るかもしれない失敗か（つながらなかった、サーバーの一時的な障害） */
const isRetryable = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 500;

export const useAccountStore = defineStore('account', () => {
  const storage = browserStorage();
  /** ランキングに出す名前（公開に同意する前は null、まだ聞いていなければ undefined） */
  const name = ref<string | null | undefined>(undefined);
  /** kan-game.app の名前（ほかのゲームで登録したもの）。あれば、ここでは公開への同意だけを求める */
  const kanGameName = ref<string | null>(null);
  const submission = ref<Submission | null>(null);
  /** 解禁の状態（サーバーの記録と、端末だけのランの結果を合わせたもの） */
  const progress = ref<Progress>(loadProgress(storage));
  /**
   * サーバーに記録してある解禁の状態（まだ聞いていなければ null）。ランキングに載るランで選べるのはこちらの範囲だけ
   * （端末だけのランで解禁したものは、サーバーが 403 で断る）
   */
  const serverProgress = ref<Progress | null>(null);
  /**
   * 端末だけのランになった理由（直前に始めたランについて。ラン終了のシートに出す）。
   * outdated は、画面の engine の版がサーバーより古かった（再読み込みを促す）
   */
  const localReason = ref<'offline' | 'locked' | 'outdated'>('offline');
  /** 送っている途中の記録（新しいランを始める前に待つ） */
  let sending: Promise<void> = Promise.resolve();
  /** 名前と解禁の状態を聞いている途中（端末だけのランを始める前に待つ） */
  let loadingMe: Promise<void> = Promise.resolve();

  function loadMe(): Promise<void> {
    loadingMe = (async () => {
      kanGameName.value = (await ensureId())?.name ?? null;
      const me = await orNull(api.me());
      if (me) {
        name.value = me.name;
        absorbServerProgress(me.progress);
      }
    })();
    return loadingMe;
  }

  /** サーバーの解禁の状態を受け取り、端末の状態にも足す */
  function absorbServerProgress(p: Progress) {
    serverProgress.value = p;
    absorbProgress(p);
  }

  /** 名前を登録して公開に同意する。失敗したら理由のコード */
  async function registerName(value: string): Promise<'ok' | string> {
    try {
      name.value = (await api.registerName(value)).name;
      return 'ok';
    } catch (e) {
      return e instanceof ApiError ? e.code : 'error';
    }
  }

  /**
   * ランキングに載せるランを始める。サーバーにつながらない、またはサーバーの記録ではまだ選べない雀士・段位なら
   * null（端末だけのランにする）。
   * サーバーは新しいランを始めると、終わっていない前のランを記録できなくする。そのため、前のランの記録を送り終えてから始め、
   * 送り直し待ちが残っている（送れなかった）ときは、その記録を失わないように端末だけのランにする
   */
  async function startRankedRun(choice: RunChoice) {
    await sending;
    await flushPending();
    localReason.value = 'offline';
    if (loadPending(storage).length) return null;
    try {
      const ranked = await api.startRun(choice);
      // サーバーの engine の版がこの画面より新しい（デプロイの前に読み込んだ画面のまま）: ランキングには載せられない
      if (ranked.engineVersion > ENGINE_VERSION) {
        localReason.value = 'outdated';
        return null;
      }
      return ranked;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'locked') localReason.value = 'locked';
      return null;
    }
  }

  /** 名前と解禁の状態の問い合わせが終わるまで待つ（失敗しても待つだけ） */
  const whenMeLoaded = () => loadingMe;

  /** 解禁の状態を足し込んで保存する（解禁は減らない） */
  function absorbProgress(p: Progress) {
    progress.value = mergeProgress(progress.value, p);
    saveProgress(storage, progress.value);
  }

  /**
   * 終わったランを解禁の状態に数え、新しく解禁されたものを返す。端末だけのランもここで数える
   * （ランキングに載るランは、サーバーも記録を確かめてから数える）
   */
  function countFinishedRun(run: RunState): NewUnlocks {
    const before = progress.value;
    absorbProgress(progressAfter(before, run));
    return newUnlocks(before, progress.value);
  }

  /** 送り直す。送れた（または断られた）ものだけを外し、そのあいだに足された記録は残す */
  async function flushPending() {
    const done = new Set<string>();
    for (const p of loadPending(storage)) {
      try {
        await api.finishRun(p.runId, p.log);
        done.add(p.runId);
      } catch (e) {
        if (!isRetryable(e)) done.add(p.runId);
      }
    }
    if (done.size) savePending(storage, loadPending(storage).filter((p) => !done.has(p.runId)));
  }

  /** 終わったランの記録を送る。runId が null なら端末だけのラン。記録が済んだランは送らない */
  function submit(runId: string | null, log: RunLog): Promise<void> {
    if (!runId) {
      submission.value = { status: 'local' };
      return Promise.resolve();
    }
    if (loadSettledRunId(storage) === runId) return Promise.resolve();
    sending = send(runId, log);
    return sending;
  }

  async function send(runId: string, log: RunLog) {
    // 送り直し待ちに同じランがあれば外す（flushPending と二重に送らない）
    savePending(
      storage,
      loadPending(storage).filter((p) => p.runId !== runId),
    );
    submission.value = { status: 'sending' };
    try {
      const result = await api.finishRun(runId, log);
      submission.value = { status: 'recorded', result };
      absorbServerProgress(result.progress);
      saveSettledRunId(storage, runId);
    } catch (e) {
      if (isRetryable(e)) {
        savePending(storage, [...loadPending(storage), { runId, log }]);
        submission.value = { status: 'queued' };
      } else {
        submission.value = { status: 'rejected', code: (e as ApiError).code };
        saveSettledRunId(storage, runId);
      }
    }
  }

  function clearSubmission() {
    submission.value = null;
  }

  const weeklyRanking = (week?: string) => orNull(api.weeklyRanking(week));

  return {
    name,
    kanGameName,
    submission,
    progress,
    serverProgress,
    localReason,
    loadMe,
    whenMeLoaded,
    registerName,
    startRankedRun,
    countFinishedRun,
    flushPending,
    submit,
    clearSubmission,
    weeklyRanking,
  };
});
