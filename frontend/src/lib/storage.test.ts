import { describe, expect, it } from 'vitest';
import { newLog } from '@pujan/engine';
import { memoryStorage } from './memory-storage';
import {
  clearRunLog,
  loadRunLog,
  loadTutorialSeen,
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
    // 基本ルールの項目が欠けている
    s.setItem('pujan.run.v1', JSON.stringify({ ...newLog(1), base: { turns: 12 } }));
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

describe('チュートリアル', () => {
  it('開いたことを覚える', () => {
    const s = memoryStorage();
    expect(loadTutorialSeen(s)).toBe(false);
    saveTutorialSeen(s);
    expect(loadTutorialSeen(s)).toBe(true);
  });
});
