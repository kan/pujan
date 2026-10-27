import { describe, expect, it } from 'vitest';
import { apply, createGame, isFinished, newLog, replay, type GameState } from '../src/game.js';
import { CHARMS, DEFAULT_BASE_RULES, SCROLL_YAKU } from '../src/items.js';
import {
  CHARACTERS,
  DEFAULT_START,
  EMPTY_PROGRESS,
  YAKUMAN_MARK,
  clampChoice,
  isProgress,
  makeStart,
  maxDan,
  newUnlocks,
  progressAfter,
  runRulesFor,
  sameStart,
  type Progress,
  type RunStart,
} from '../src/progression.js';
import type { Offer } from '../src/run.js';
import { botAction } from '../src/sim.js';

/** AI に 1 ランを遊ばせる（ショップでは何も買わない）。開いたショップの品をすべて集める */
function playRun(seed: number, start: RunStart): { final: GameState; offers: Offer[][] } {
  let g = createGame(seed, { start });
  const offers: Offer[][] = [];
  while (!isFinished(g)) {
    if (g.kyoku && !g.kyoku.result) g = apply(g, botAction(g.kyoku, { target: '和了形', riichi: true }));
    else if (g.kyoku) {
      g = apply(g, { type: 'settle', renchan: false });
      if (g.run.shop) offers.push(g.run.shop);
    } else g = apply(g, { type: 'leave' });
  }
  return { final: g, offers };
}

const progress = (p: Partial<Progress>): Progress => ({ ...EMPTY_PROGRESS, ...p });

describe('雀士と段位のルール', () => {
  it('標準の雀士・初段は今までの既定と同じ', () => {
    const r = runRulesFor(DEFAULT_START);
    expect(r.base).toEqual(DEFAULT_BASE_RULES);
    expect(r.targets).toEqual([1000, 2000, 4000, 8000]);
    expect(r.startMoney).toBe(4);
    expect(r.shopSize).toBe(3);
  });

  it('段位が上がると縛りが重なる', () => {
    const at = (dan: number) => runRulesFor({ ...DEFAULT_START, dan });
    expect(at(1).targets).toEqual([1500, 3000, 6000, 12000]);
    expect(at(2).startMoney).toBe(2);
    expect(at(3).base.turns).toBe(DEFAULT_BASE_RULES.turns - 1);
    expect(at(4).targets).toEqual([2000, 4000, 8000, 16000]);
    expect(at(5)).toMatchObject({ shopSize: 2, startMoney: 2, base: { turns: DEFAULT_BASE_RULES.turns - 1 } });
  });

  it('雀士で始めの条件が変わる', () => {
    const g = createGame(1, { start: { ...DEFAULT_START, character: 'menzen' } });
    expect(g.run.base.holdSlots).toBe(0);
    expect(g.run.base.next).toBe(3);
    expect(g.run.charms).toEqual(['damaten']);
    expect(g.kyoku!.hold).toHaveLength(0);
    const y = createGame(1, { start: { ...DEFAULT_START, character: 'yakuman', dan: 2 } });
    expect(y.run.equipment).toEqual(['joker']);
    expect(y.run.money).toBe(0);
  });

  it('雀聖のショップは品が 2 つ', () => {
    const { offers } = playRun(5, { ...DEFAULT_START, dan: 5 });
    expect(offers.length).toBeGreaterThan(0);
    for (const shop of offers) expect(shop).toHaveLength(2);
  });
});

describe('役の解禁', () => {
  it('解禁がなければ、役の巻物と役で解禁されるお守りは並ばない', () => {
    const all = [1, 2, 3, 4].flatMap((seed) => playRun(seed, DEFAULT_START).offers.flat());
    expect(all.length).toBeGreaterThan(20);
    expect(all.some((o) => o.kind === 'scroll')).toBe(false);
    const locked = CHARMS.filter((c) => c.unlockYaku).map((c) => c.id as string);
    expect(all.some((o) => o.kind === 'charm' && locked.includes(o.id))).toBe(false);
  });

  it('解禁済みの役の巻物だけが並ぶ', () => {
    const start = { ...DEFAULT_START, unlockedYaku: ['役牌', '混一色'] };
    const all = [1, 2, 3, 4].flatMap((seed) => playRun(seed, start).offers.flat());
    const scrolls = all.filter((o) => o.kind === 'scroll').map((o) => (o as { yaku: string }).yaku);
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every((y) => y === '役牌' || y === '混一色')).toBe(true);
    // 白紙委任はプチ小三元で解禁されるので、まだ並ばない
    expect(all.some((o) => o.kind === 'charm' && o.id === 'hakushi')).toBe(false);
  });

  it('ランで和了った役を覚える', () => {
    const { final } = playRun(1, DEFAULT_START);
    expect(final.run.yakuWon.length).toBeGreaterThan(0);
    expect(new Set(final.run.yakuWon).size).toBe(final.run.yakuWon.length);
  });
});

describe('解禁の状態', () => {
  it('ランのあとに和了った役・突破した場・クリアした段位を足す', () => {
    const { final } = playRun(1, DEFAULT_START);
    const p = progressAfter(progress({ yakuWon: ['プチ国士'] }), final.run);
    expect(p.yakuWon).toContain('プチ国士');
    for (const y of final.run.yakuWon) expect(p.yakuWon).toContain(y);
    expect(p.bestWaves).toBe(final.run.phase === 'cleared' ? 4 : final.run.wave);
    // 記録は下がらない
    expect(progressAfter(progress({ bestWaves: 4, danCleared: 3 }), final.run)).toMatchObject({ bestWaves: 4, danCleared: 3 });
  });

  it('全場クリアした段位の次の段位まで選べる', () => {
    expect(maxDan(EMPTY_PROGRESS)).toBe(0);
    expect(maxDan(progress({ danCleared: 0 }))).toBe(1);
    expect(maxDan(progress({ danCleared: 5 }))).toBe(5);
  });

  it('始めの条件は、選べる雀士と段位のときだけ作る', () => {
    expect(makeStart(EMPTY_PROGRESS, 'standard', 0)).toEqual(DEFAULT_START);
    expect(makeStart(EMPTY_PROGRESS, 'speed', 0)).toBeNull();
    expect(makeStart(EMPTY_PROGRESS, 'standard', 1)).toBeNull();
    expect(makeStart(EMPTY_PROGRESS, 'nobody', 0)).toBeNull();
    expect(makeStart(EMPTY_PROGRESS, 'standard', 0.5)).toBeNull();
    const p = progress({ yakuWon: ['門前', '役牌'], bestWaves: 1, danCleared: 0 });
    expect(makeStart(p, 'menzen', 1)).toEqual({ character: 'menzen', dan: 1, unlockedYaku: ['役牌', '門前'].sort() });
    expect(makeStart(p, 'speed', 1)).not.toBeNull();
  });

  it('雀士の解禁の条件', () => {
    const open = (p: Progress) => CHARACTERS.filter((c) => c.unlocked(p)).map((c) => c.id);
    expect(open(EMPTY_PROGRESS)).toEqual(['standard']);
    expect(open(progress({ bestWaves: 2, yakuWon: ['門前', YAKUMAN_MARK] }))).toEqual(['standard', 'speed', 'menzen', 'oya', 'yakuman']);
  });

  it('新しく解禁されたものを並べる', () => {
    const before = progress({ yakuWon: ['役牌'] });
    const after = progress({ yakuWon: ['役牌', '混一色', '門前'], bestWaves: 4, danCleared: 0 });
    expect(newUnlocks(before, after)).toEqual({
      characters: ['speed', 'menzen', 'oya'],
      dans: [1],
      scrolls: ['門前', '混一色'],
      charms: ['iromegane'],
    });
  });

  it('選べない雀士と段位は、選べる範囲に収める', () => {
    const p = progress({ bestWaves: 1, danCleared: 0 });
    expect(clampChoice(p, { character: 'speed', dan: 1 })).toEqual({ character: 'speed', dan: 1 });
    expect(clampChoice(p, { character: 'oya', dan: 4 })).toEqual({ character: 'standard', dan: 1 });
  });

  it('解禁の状態の形を確かめる', () => {
    expect(isProgress(EMPTY_PROGRESS)).toBe(true);
    expect(isProgress({ yakuWon: [1], bestWaves: 0, danCleared: -1 })).toBe(false);
    expect(isProgress({ yakuWon: [], bestWaves: 0.5, danCleared: -1 })).toBe(false);
    expect(isProgress(null)).toBe(false);
  });

  it('始めの条件の比較は役の並びによらない', () => {
    expect(sameStart({ ...DEFAULT_START, unlockedYaku: ['a', 'b'] }, { ...DEFAULT_START, unlockedYaku: ['b', 'a'] })).toBe(true);
    expect(sameStart(DEFAULT_START, { ...DEFAULT_START, dan: 1 })).toBe(false);
  });

  it('巻物の役はすべて和了れる役の名前', () => {
    // 解禁は和了った役の名前で決めるので、名前が食い違うと永遠に並ばない
    expect(SCROLL_YAKU.length).toBeGreaterThan(0);
    const needs = CHARMS.flatMap((c) => (c.unlockYaku ? [c.unlockYaku] : []));
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.every((y) => SCROLL_YAKU.includes(y))).toBe(true);
  });
});

describe('始めの条件と再生', () => {
  it('始めの条件ごと再生できる', () => {
    const start: RunStart = { character: 'speed', dan: 3, unlockedYaku: ['役牌'] };
    const log = newLog(9, start);
    let g = createGame(9, { start });
    for (let i = 0; i < 40 && !isFinished(g); i++) {
      const a = g.kyoku && !g.kyoku.result ? botAction(g.kyoku, { target: '和了形', riichi: true }) : g.kyoku ? { type: 'settle' as const } : { type: 'leave' as const };
      g = apply(g, a);
      log.actions.push(a);
    }
    expect(replay(log)).toEqual(g);
  });

  it('形の違う始めの条件は再生しない', () => {
    expect(() => replay({ ...newLog(1), start: { character: 'x', dan: 0, unlockedYaku: [] } as never })).toThrow(/run start/);
    expect(() => replay({ ...newLog(1), start: { ...DEFAULT_START, dan: 9 } })).toThrow(/run start/);
    expect(() => replay({ ...newLog(1), start: undefined as never })).toThrow(/run start/);
  });
});
