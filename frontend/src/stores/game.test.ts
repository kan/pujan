import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { EMPTY_PROGRESS, ENGINE_VERSION, makeStart, ownedCharms, type Progress } from '@pujan/engine';
import { memoryStorage } from '@/lib/memory-storage';
import { useAccountStore } from './account';
import { useGameStore } from './game';

/** 偽のサーバー。server.online が false の間はつながらない */
const server = {
  online: false,
  seed: 4242,
  /** 記録の送信に返す失敗の状態（0 なら成功） */
  finishError: 0,
  finished: [] as { runId: string; actions: number }[],
  /** サーバーに記録してある解禁の状態 */
  progress: EMPTY_PROGRESS as Progress,
  /** サーバーの engine の版（画面より新しい版がデプロイされたときを試す） */
  engineVersion: ENGINE_VERSION,
};

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!server.online) throw new TypeError('offline');
  const path = String(input);
  if (path === '/api/id/session') return Response.json({ id: 'x', name: null, status: 'active' });
  if (path === '/api/me') return Response.json({ id: 'x', name: null, progress: server.progress });
  if (path === '/api/runs') {
    const choice = JSON.parse(String(init?.body));
    const start = makeStart(server.progress, choice.character, choice.dan);
    if (!start) return Response.json({ error: 'locked' }, { status: 403 });
    return Response.json({ id: 'run-1', seed: server.seed, engineVersion: server.engineVersion, start }, { status: 201 });
  }
  const finish = /^\/api\/runs\/(.+)\/finish$/.exec(path);
  if (finish) {
    if (server.finishError) return Response.json({ error: 'error' }, { status: server.finishError });
    const body = JSON.parse(String(init?.body));
    server.finished.push({ runId: finish[1], actions: body.log.actions.length });
    return Response.json({ wavesCleared: 0, totalScore: 0, week: '2026-10-26', best: true, progress: server.progress });
  }
  return Response.json({ error: 'not_found' }, { status: 404 });
}

// ストアは window.localStorage に保存する。テストではメモリの保存先と偽のサーバーを置く
let storage: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  storage = memoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  vi.stubGlobal('fetch', fakeFetch);
  server.online = false;
  server.finishError = 0;
  server.finished = [];
  server.progress = EMPTY_PROGRESS;
  server.engineVersion = ENGINE_VERSION;
  setActivePinia(createPinia());
});

/** ツモ切りを n 回（ツモ牌は最初から選ばれているので、1 回のタップで捨てる） */
function discardDrawn(store: ReturnType<typeof useGameStore>, n: number) {
  for (let i = 0; i < n && store.acting; i++) store.tapTile('drawn', 0);
}

/** 開き直す（新しい Pinia でストアを作り直して init） */
async function reopen() {
  setActivePinia(createPinia());
  const store = useGameStore();
  await store.init();
  return store;
}

describe('ゲームのストア', () => {
  it('保存がなければ新しいランを始め、操作ログを保存する', async () => {
    const store = useGameStore();
    await store.init();
    expect(store.acting).toBe(true);
    // 最初はツモ牌を選んでいる
    expect(store.selection).toEqual({ zone: 'drawn', index: 0 });
    const saved = JSON.parse(storage.data.get('pujan.run.v1')!);
    expect(saved.engineVersion).toBe(ENGINE_VERSION);
    expect(saved.actions).toEqual([]);
  });

  it('1 回目のタップで選び、同じ牌の 2 回目で捨てる', async () => {
    const store = useGameStore();
    await store.init();
    store.tapTile('hand', 1);
    expect(store.selection).toEqual({ zone: 'hand', index: 1 });
    expect(store.kyoku!.river).toHaveLength(0);
    const tile = store.kyoku!.hand[1];
    store.tapTile('hand', 1);
    expect(store.kyoku!.river).toEqual([tile]);
  });

  it('開き直すと同じ局面に戻る', async () => {
    const a = useGameStore();
    await a.init();
    discardDrawn(a, 3);
    expect(a.kyoku!.river).toHaveLength(3);
    const b = await reopen();
    expect(b.kyoku!.turn).toBe(a.kyoku!.turn);
    expect(b.kyoku!.river).toEqual(a.kyoku!.river);
    expect(b.log.actions).toHaveLength(3);
  });

  it('選んだ牌を空き枠に保留できる', async () => {
    const store = useGameStore();
    await store.init();
    store.tapTile('hand', 0);
    expect(store.canHold).toBe(true);
    const tile = store.kyoku!.hand[0];
    store.tapSlot(1);
    expect(store.kyoku!.hold[1]).toEqual(tile);
  });

  it('再生できない保存（版が違う）は捨てて新しいランを始める', async () => {
    storage.setItem('pujan.run.v1', JSON.stringify({ engineVersion: ENGINE_VERSION + 1, seed: 1, base: {}, actions: [] }));
    const store = useGameStore();
    await store.init();
    expect(store.log.engineVersion).toBe(ENGINE_VERSION);
    expect(store.acting).toBe(true);
  });

  it('できない操作はログに積まない', async () => {
    const store = useGameStore();
    await store.init();
    expect(store.act({ type: 'reroll' })).toBe(false);
    expect(store.log.actions).toHaveLength(0);
  });

  it('局が終わると精算・ショップへ進み、直前の局を表示に残す', async () => {
    const store = useGameStore();
    await store.init();
    discardDrawn(store, 30);
    if (store.kyoku?.result?.type !== 'draw') return; // まれに天和などで和了れる
    expect(store.act({ type: 'settle' })).toBe(true);
    expect(store.run.phase).toBe('shop');
    expect(store.kyoku).toBeNull();
    expect(store.shownKyoku).not.toBeNull();

    // ショップで開き直しても、直前の局を後ろに出せる
    const reopened = await reopen();
    expect(reopened.run.phase).toBe('shop');
    expect(reopened.shownKyoku?.result?.type).toBe('draw');
    expect(reopened.act({ type: 'leave' })).toBe(true);
    expect(reopened.run.round.kyoku).toBe(1);
  });

  it('場の案内はランの始めに出て、閉じたら配牌を引き直しても戻らない', async () => {
    const store = useGameStore();
    await store.init();
    expect(store.showIntro).toBe(true);
    store.dismiss();
    expect(store.showIntro).toBe(false);
    if (store.canRedealNow) {
      store.act({ type: 'redeal' });
      expect(store.showIntro).toBe(false);
    }
    discardDrawn(store, 1);
    expect(store.showIntro).toBe(false);
  });
});

describe('ランキングに載せるラン', () => {
  /** ラン終了まで、ツモ切りと精算とショップを出るのを続ける */
  function playToEnd(store: ReturnType<typeof useGameStore>) {
    for (let i = 0; i < 2000 && store.run.phase !== 'over' && store.run.phase !== 'cleared'; i++) {
      if (store.acting) store.tapTile('drawn', 0);
      else if (store.kyoku?.result) store.act({ type: 'settle' });
      else store.act({ type: 'leave' });
    }
  }

  it('サーバーにつながればサーバーのシードで始め、終わったら記録を送る', async () => {
    server.online = true;
    const store = useGameStore();
    await store.init();
    expect(store.log.seed).toBe(server.seed);
    expect(store.runId).toBe('run-1');
    playToEnd(store);
    await vi.waitFor(() => expect(server.finished).toHaveLength(1));
    expect(server.finished[0]).toEqual({ runId: 'run-1', actions: store.log.actions.length });
    expect(useAccountStore().submission?.status).toBe('recorded');
  });

  it('つながらなければ端末だけのラン。つながってから始めたランはサーバーのラン', async () => {
    const store = useGameStore();
    await store.init();
    expect(store.runId).toBeNull();

    server.online = true;
    await store.startRun();
    expect(store.runId).toBe('run-1');
    expect(store.log.seed).toBe(server.seed);
  });

  it('サーバーの版が画面より新しければ、端末だけのランにして再読み込みを促す', async () => {
    server.online = true;
    server.engineVersion = ENGINE_VERSION + 1;
    const store = useGameStore();
    await store.init();
    expect(store.runId).toBeNull();
    expect(store.outdated).toBe(true);
    expect(useAccountStore().localReason).toBe('outdated');
    playToEnd(store);
    expect(useAccountStore().submission?.status).toBe('local');
    expect(server.finished).toHaveLength(0);
  });

  it('サーバーの版が同じなら再読み込みを促さない', async () => {
    server.online = true;
    const store = useGameStore();
    await store.init();
    expect(store.outdated).toBe(false);
  });

  it('サーバーの一時的な障害（5xx）は送り直し待ちにし、残っている間は新しいランを端末だけのランにする', async () => {
    server.online = true;
    server.finishError = 503;
    const store = useGameStore();
    await store.init();
    playToEnd(store);
    await vi.waitFor(() => expect(useAccountStore().submission?.status).toBe('queued'));
    // 送り直しも失敗する: 前のランの記録を失わないように、新しいランはサーバーに聞かない
    await store.startRun();
    expect(store.runId).toBeNull();
    expect(JSON.parse(storage.data.get('pujan.pending.v1')!)).toHaveLength(1);
    // 障害が直れば、次のランを始める前に送り直してからサーバーのランにする
    server.finishError = 0;
    await store.startRun();
    expect(server.finished).toHaveLength(1);
    expect(store.runId).toBe('run-1');
  });

  it('記録が済んだランは、開き直しても送らない', async () => {
    server.online = true;
    const store = useGameStore();
    await store.init();
    playToEnd(store);
    await vi.waitFor(() => expect(server.finished).toHaveLength(1));
    await reopen();
    await new Promise((r) => setTimeout(r, 20));
    expect(server.finished).toHaveLength(1);
  });

  it('記録を送れなかったら端末に残し、次に開いたときに送り直す', async () => {
    server.online = true;
    const store = useGameStore();
    await store.init();
    server.online = false;
    playToEnd(store);
    await vi.waitFor(() => expect(useAccountStore().submission?.status).toBe('queued'));
    expect(JSON.parse(storage.data.get('pujan.pending.v1')!)).toHaveLength(1);

    server.online = true;
    await reopen();
    await vi.waitFor(() => expect(server.finished.length).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() => expect(JSON.parse(storage.data.get('pujan.pending.v1')!)).toHaveLength(0));
  });

  it('選んだ雀士と段位で始め、次のランの準備のために覚える', async () => {
    server.online = true;
    server.progress = { yakuWon: ['役牌'], bestWaves: 2, danCleared: 0, characters: ['oya', 'speed'] };
    const store = useGameStore();
    await store.init();
    await store.startRun({ character: 'oya', dan: 1 });
    expect(store.runId).toBe('run-1');
    expect(store.run.start).toEqual({ character: 'oya', dan: 1, unlockedYaku: ['役牌'] });
    expect(ownedCharms(store.run)).toEqual(['oyaji']);
    expect(JSON.parse(storage.data.get('pujan.choice.v1')!)).toEqual({ character: 'oya', dan: 1 });
    // サーバーの解禁の状態は端末にも残る
    expect(useAccountStore().progress).toEqual(server.progress);
  });

  it('サーバーの記録ではまだ選べない雀士は、端末の記録で端末だけのランにする', async () => {
    server.online = true;
    storage.setItem('pujan.progress.v1', JSON.stringify({ yakuWon: [], bestWaves: 1, danCleared: -1 }));
    const store = useGameStore();
    await store.init();
    await store.startRun({ character: 'speed', dan: 0 });
    expect(store.runId).toBeNull();
    expect(store.run.start.character).toBe('speed');
    expect(useAccountStore().localReason).toBe('locked');
    // どちらの記録でも選べない組み合わせは、標準の雀士・初段にする
    await store.startRun({ character: 'yakuman', dan: 3 });
    expect(store.run.start).toMatchObject({ character: 'standard', dan: 0 });
  });

  it('終わったランは端末だけのランでも解禁に数える', async () => {
    const store = useGameStore();
    await store.init();
    expect(store.unlocks).toBeNull();
    playToEnd(store);
    expect(store.unlocks).not.toBeNull();
    expect(storage.data.has('pujan.progress.v2')).toBe(true);
  });
});
