import { describe, expect, it } from 'vitest';
import { apply, createGame, isFinished, newLog, replay, type GameState } from '../src/game.js';
import { CHARMS, DEFAULT_BASE_RULES, SCROLL_YAKU } from '../src/items.js';
import {
  CHARACTERS,
  DEFAULT_START,
  EMPTY_PROGRESS,
  YAKUMAN_MARK,
  clampChoice,
  characterUnlocked,
  parseProgress,
  withCharacters,
  makeStart,
  maxDan,
  newUnlocks,
  progressAfter,
  runRulesFor,
  sameStart,
  type Progress,
  type RunStart,
} from '../src/progression.js';
import { buyBlocker, createRun, ownedCharms, reroll, type Offer } from '../src/run.js';
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

/** 解禁の状態。雀士の一覧を渡さなければ、前の形と同じく条件を満たした雀士を解禁済みにする */
const progress = (p: Partial<Progress>): Progress => withCharacters({ yakuWon: [], bestWaves: 0, danCleared: -1, ...p });

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
    expect(at(1).clearBonus).toBe(3);
    expect(at(2).clearBonus).toBe(2);
    expect(at(3).base.turns).toBe(DEFAULT_BASE_RULES.turns - 1);
    expect(at(4).targets).toEqual([2000, 4000, 8000, 16000]);
    expect(at(5)).toMatchObject({ shopSize: 2, clearBonus: 2, startMoney: 4, base: { turns: DEFAULT_BASE_RULES.turns - 1 } });
    // 始めの祝儀が 0 の雀士にも、三段の縛りは効く
    expect(runRulesFor({ character: 'oya', dan: 2 }).clearBonus).toBe(2);
  });

  it('場を突破したときの祝儀は段位で減る', () => {
    /** 東場を突破した直後の祝儀の内訳（突破できなかったら null） */
    const firstBonus = (seed: number, dan: number) => {
      let g = createGame(seed, { start: { ...DEFAULT_START, dan } });
      while (!isFinished(g)) {
        if (g.run.lastWaveBonus) return g.run.lastWaveBonus;
        if (g.kyoku && !g.kyoku.result) g = apply(g, botAction(g.kyoku, { target: '和了形', riichi: true }));
        else if (g.kyoku) g = apply(g, { type: 'settle', renchan: true });
        else g = apply(g, { type: 'leave' });
      }
      return null;
    };
    const bonusAt = (dan: number) => [1, 2, 3, 4, 5].map((seed) => firstBonus(seed, dan)).find(Boolean);
    expect(bonusAt(0)?.clear).toBe(3);
    expect(bonusAt(2)?.clear).toBe(2);
  });

  it('雀士で始めの条件が変わる', () => {
    const g = createGame(1, { start: { ...DEFAULT_START, character: 'menzen' } });
    expect(g.run.base.holdSlots).toBe(0);
    expect(g.run.base.next).toBe(4);
    // かめは巡数が 3 多い。段位で巡数が減っても上乗せになる（四段は 11 巡なので 14 巡）
    expect(g.run.base.turns).toBe(15);
    expect(createGame(1, { start: { ...DEFAULT_START, character: 'menzen', dan: 3 } }).run.base.turns).toBe(14);
    expect(createGame(1, { start: { ...DEFAULT_START, character: 'oya' } }).run.money).toBe(2);
    // 固有のお守りは枠に数えないので、買ったお守りの一覧（charms）には入らない
    expect(g.run.charms).toEqual([]);
    expect(ownedCharms(g.run)).toEqual(['damaten']);
    expect(g.kyoku!.setup.mods.menzenHan).toBe(2);
    expect(g.kyoku!.hold).toHaveLength(0);
    const y = createGame(1, { start: { ...DEFAULT_START, character: 'yakuman', dan: 2 } });
    expect(y.run.equipment).toEqual(['joker']);
    expect(y.run.money).toBe(0);
  });

  it('固有のお守りは枠に数えず、売れず、ショップにも並ばない', () => {
    let g = createGame(2, { start: { ...DEFAULT_START, character: 'oya' } });
    while (g.kyoku) g = apply(g, g.kyoku.result ? { type: 'settle' } : botAction(g.kyoku, { target: '和了形' }));
    // 買ったお守りがなければ売れない（固有の親父の背中は売る対象にならない）
    expect(() => apply(g, { type: 'sell', index: 0 })).toThrow();
    // 枠は買ったお守りだけで数える: 5 つ買っていても固有のぶんで満杯にならない
    const four = ['hayazashi', 'yasude', 'damaten', 'ippatsuya'] as const;
    const offer = { kind: 'charm' as const, id: 'bakuchi' as const, price: 5, sold: false };
    const run = { ...g.run, money: 99, charms: [...four], shop: [offer] };
    expect(buyBlocker(run, 0)).toBeNull();
    expect(buyBlocker({ ...run, charms: [...four, 'chokin' as const] }, 0)).toBe('charmsFull');
    // 固有のお守りは「持っている」ので、ショップに並ばない
    for (let i = 0; i < 20; i++) {
      for (const o of reroll({ ...g.run, money: 99 }).shop ?? []) expect(o.kind === 'charm' && o.id === 'oyaji').toBe(false);
      g = { ...g, run: { ...g.run, rng: g.run.rng + 1 } };
    }
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
    const met = (p: Progress) => CHARACTERS.filter((c) => c.condition(p)).map((c) => c.id);
    expect(met(EMPTY_PROGRESS)).toEqual(['standard']);
    // ねこは全場クリアし、役満でも和了ったときだけ
    expect(met(progress({ bestWaves: 2, yakuWon: ['門前', YAKUMAN_MARK] }))).toEqual(['standard', 'speed', 'menzen', 'oya']);
    expect(met(progress({ bestWaves: 4, danCleared: 0, yakuWon: ['門前', YAKUMAN_MARK] }))).toEqual([
      'standard',
      'speed',
      'menzen',
      'oya',
      'yakuman',
    ]);
  });

  it('雀士は 1 回のランで 1 人まで、一覧の順に解禁し、残りは次のランを終えたときに解禁する', () => {
    // 南場まで突破し、門前でも和了ったラン（うさぎ・かめ・ぞうの条件を満たす）
    const ended = (wave: number, yakuWon: string[]) => ({ ...createRun(1), phase: 'over' as const, wave, yakuWon });
    let p = progressAfter(EMPTY_PROGRESS, ended(2, ['門前']));
    expect(p.characters).toEqual(['speed']);
    expect(characterUnlocked(p, 'menzen')).toBe(false);
    // 次のランは東場で負けても、満たした条件は残っているので 1 人ずつ解禁される
    // （一覧の並びは ID の順）
    p = progressAfter(p, ended(0, []));
    expect(p.characters).toEqual(['menzen', 'speed']);
    p = progressAfter(p, ended(0, []));
    expect(p.characters).toEqual(['menzen', 'oya', 'speed']);
    // 条件を満たした雀士がもういなければ増えない
    expect(progressAfter(p, ended(0, [])).characters).toEqual(['menzen', 'oya', 'speed']);
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

  it('解禁の状態の形を確かめる。雀士の一覧がない前の形は、条件を満たした雀士を解禁済みにする', () => {
    expect(parseProgress(EMPTY_PROGRESS)).toEqual(EMPTY_PROGRESS);
    expect(parseProgress({ yakuWon: [1], bestWaves: 0, danCleared: -1 })).toBeNull();
    expect(parseProgress({ yakuWon: [], bestWaves: 0.5, danCleared: -1 })).toBeNull();
    expect(parseProgress({ ...EMPTY_PROGRESS, characters: ['nobody'] })).toBeNull();
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress({ yakuWon: [], bestWaves: 2, danCleared: -1 })?.characters).toEqual(['oya', 'speed']);
    expect(parseProgress({ yakuWon: [], bestWaves: 2, danCleared: -1, characters: ['speed'] })?.characters).toEqual(['speed']);
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
