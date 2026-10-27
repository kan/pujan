import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ENGINE_VERSION } from '@pujan/engine';
import { memoryStorage } from '@/lib/memory-storage';
import { useGameStore } from './game';

// ストアは window.localStorage に保存する。テストではメモリの保存先を置く
let storage: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  storage = memoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  setActivePinia(createPinia());
});

/** ツモ切りを n 回（ツモ牌は最初から選ばれているので、1 回のタップで捨てる） */
function discardDrawn(store: ReturnType<typeof useGameStore>, n: number) {
  for (let i = 0; i < n && store.acting; i++) store.tapTile('drawn', 0);
}

describe('ゲームのストア', () => {
  it('保存がなければ新しいランを始め、操作ログを保存する', () => {
    const store = useGameStore();
    store.init();
    expect(store.acting).toBe(true);
    // 最初はツモ牌を選んでいる
    expect(store.selection).toEqual({ zone: 'drawn', index: 0 });
    const saved = JSON.parse(storage.data.get('pujan.run.v1')!);
    expect(saved.engineVersion).toBe(ENGINE_VERSION);
    expect(saved.actions).toEqual([]);
  });

  it('1 回目のタップで選び、同じ牌の 2 回目で捨てる', () => {
    const store = useGameStore();
    store.init();
    store.tapTile('hand', 1);
    expect(store.selection).toEqual({ zone: 'hand', index: 1 });
    expect(store.kyoku!.river).toHaveLength(0);
    const tile = store.kyoku!.hand[1];
    store.tapTile('hand', 1);
    expect(store.kyoku!.river).toEqual([tile]);
  });

  it('開き直すと同じ局面に戻る', () => {
    const a = useGameStore();
    a.init();
    discardDrawn(a, 3);
    expect(a.kyoku!.river).toHaveLength(3);
    const turn = a.kyoku!.turn;

    setActivePinia(createPinia());
    const b = useGameStore();
    b.init();
    expect(b.kyoku!.turn).toBe(turn);
    expect(b.kyoku!.river).toEqual(a.kyoku!.river);
    expect(b.log.actions).toHaveLength(3);
  });

  it('選んだ牌を空き枠に保留できる', () => {
    const store = useGameStore();
    store.init();
    store.tapTile('hand', 0);
    expect(store.canHold).toBe(true);
    const tile = store.kyoku!.hand[0];
    store.tapSlot(1);
    expect(store.kyoku!.hold[1]).toEqual(tile);
  });

  it('再生できない保存（版が違う）は捨てて新しいランを始める', () => {
    storage.setItem(
      'pujan.run.v1',
      JSON.stringify({ engineVersion: ENGINE_VERSION + 1, seed: 1, base: {}, actions: [] }),
    );
    const store = useGameStore();
    store.init();
    expect(store.log.engineVersion).toBe(ENGINE_VERSION);
    expect(store.acting).toBe(true);
  });

  it('できない操作はログに積まない', () => {
    const store = useGameStore();
    store.init();
    expect(store.act({ type: 'reroll' })).toBe(false);
    expect(store.log.actions).toHaveLength(0);
  });

  it('局が終わると精算・ショップへ進み、直前の局を表示に残す', () => {
    const store = useGameStore();
    store.init();
    discardDrawn(store, 30);
    if (store.kyoku?.result?.type !== 'draw') return; // まれに天和などで和了れる
    expect(store.act({ type: 'settle' })).toBe(true);
    expect(store.run.phase).toBe('shop');
    expect(store.kyoku).toBeNull();
    expect(store.shownKyoku).not.toBeNull();

    // ショップで開き直しても、直前の局を後ろに出せる
    setActivePinia(createPinia());
    const reopened = useGameStore();
    reopened.init();
    expect(reopened.run.phase).toBe('shop');
    expect(reopened.shownKyoku?.result?.type).toBe('draw');

    expect(reopened.act({ type: 'leave' })).toBe(true);
    expect(reopened.run.round.kyoku).toBe(1);
  });

  it('場の案内はランの始めに出て、閉じたら配牌を引き直しても戻らない', () => {
    const store = useGameStore();
    store.init();
    expect(store.showIntro).toBe(true);
    store.dismiss();
    expect(store.showIntro).toBe(false);
    if (store.canRedealNow) {
      store.act({ type: 'redeal' });
      expect(store.showIntro).toBe(false);
    }
    // 局を進めたら出ない
    discardDrawn(store, 1);
    expect(store.showIntro).toBe(false);
  });
});
