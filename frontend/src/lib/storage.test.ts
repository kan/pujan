import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_RULES, newLog } from '@pujan/engine';
import { memoryStorage } from './memory-storage';
import { clearRunLog, loadRules, loadRunLog, saveRules, saveRunLog, type KeyValueStorage } from './storage';

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

describe('ルール設定', () => {
  it('保存がなければ既定値、足りない項目や型の違う項目は既定値で埋める', () => {
    const s = memoryStorage();
    expect(loadRules(s)).toEqual(DEFAULT_BASE_RULES);
    s.setItem('pujan.rules.v1', JSON.stringify({ turns: 16, holdSlots: '2', redFives: false }));
    expect(loadRules(s)).toEqual({ ...DEFAULT_BASE_RULES, turns: 16, redFives: false });
  });

  it('保存した設定を読み戻せる', () => {
    const s = memoryStorage();
    const r = { turns: 8, holdSlots: 0, next: 1, redFives: false, haitei: false };
    saveRules(s, r);
    expect(loadRules(s)).toEqual(r);
  });
});
