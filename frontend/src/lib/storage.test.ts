import { describe, expect, it } from 'vitest';
import { EMPTY_PROGRESS, newLog } from '@pujan/engine';
import { memoryStorage } from './memory-storage';
import {
  clearRunLog,
  loadChoice,
  loadProgress,
  loadRunLog,
  loadTutorialSeen,
  saveChoice,
  saveProgress,
  saveRunLog,
  saveTutorialSeen,
  type KeyValueStorage,
} from './storage';

describe('操作ログの保存', () => {
  it('保存したログを読み戻せる', () => {
    const s = memoryStorage();
    const log = { ...newLog(123), actions: [{ type: 'discard' as const, zone: 'drawn' as const, index: 0 }] };
    saveRunLog(s, log);
    expect(loadRunLog(s)).toEqual(log);
    clearRunLog(s);
    expect(loadRunLog(s)).toBeNull();
  });

  it('壊れた中身や形の違う中身は null', () => {
    const s = memoryStorage();
    s.setItem('pujan.run.v1', '{not json');
    expect(loadRunLog(s)).toBeNull();
    s.setItem('pujan.run.v1', JSON.stringify({ seed: 1 }));
    expect(loadRunLog(s)).toBeNull();
    // 始めの条件がない（雀士と段位ができる前のログ）・形が違う
    const { start: _, ...noStart } = newLog(1);
    s.setItem('pujan.run.v1', JSON.stringify({ ...noStart, base: { turns: 12 } }));
    expect(loadRunLog(s)).toBeNull();
    s.setItem('pujan.run.v1', JSON.stringify({ ...newLog(1), start: { character: 'x', dan: 0, unlockedYaku: [] } }));
    expect(loadRunLog(s)).toBeNull();
  });

  it('保存先がない・例外を投げるときも止まらない', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => saveRunLog(broken, newLog(1))).not.toThrow();
    expect(loadRunLog(broken)).toBeNull();
    expect(() => clearRunLog(broken)).not.toThrow();
    expect(loadRunLog(null)).toBeNull();
  });
});

describe('解禁の状態と選んだ雀士', () => {
  it('保存して読み戻す。形が違えば初めの状態', () => {
    const s = memoryStorage();
    expect(loadProgress(s)).toEqual(EMPTY_PROGRESS);
    const p = { yakuWon: ['役牌'], bestWaves: 2, danCleared: 0 };
    saveProgress(s, p);
    expect(loadProgress(s)).toEqual(p);
    s.setItem('pujan.progress.v1', JSON.stringify({ yakuWon: [1], bestWaves: 2, danCleared: 0 }));
    expect(loadProgress(s)).toEqual(EMPTY_PROGRESS);
  });

  it('知らない雀士や範囲の外の段位は既定に戻す', () => {
    const s = memoryStorage();
    expect(loadChoice(s)).toEqual({ character: 'standard', dan: 0 });
    saveChoice(s, { character: 'menzen', dan: 2 });
    expect(loadChoice(s)).toEqual({ character: 'menzen', dan: 2 });
    s.setItem('pujan.choice.v1', JSON.stringify({ character: 'x', dan: 99 }));
    expect(loadChoice(s)).toEqual({ character: 'standard', dan: 0 });
  });
});

describe('チュートリアル', () => {
  it('開いたことを覚える', () => {
    const s = memoryStorage();
    expect(loadTutorialSeen(s)).toBe(false);
    saveTutorialSeen(s);
    expect(loadTutorialSeen(s)).toBe(true);
  });
});
