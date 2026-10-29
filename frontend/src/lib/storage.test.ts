import { describe, expect, it } from 'vitest';
import { EMPTY_PROGRESS, newLog, type Progress } from '@pujan/engine';
import { memoryStorage } from './memory-storage';
import {
  addSentFeedback,
  clearRunLog,
  loadSentFeedback,
  MAX_SENT_FEEDBACK,
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
    const p: Progress = { yakuWon: ['役牌'], bestWaves: 2, danCleared: 0, characters: ['speed'] };
    saveProgress(s, p);
    expect(loadProgress(s)).toEqual(p);
    s.setItem('pujan.progress.v2', JSON.stringify({ yakuWon: [1], bestWaves: 2, danCleared: 0 }));
    expect(loadProgress(s)).toEqual(EMPTY_PROGRESS);
    s.setItem('pujan.progress.v2', JSON.stringify({ ...p, characters: ['nobody'] }));
    expect(loadProgress(s)).toEqual(EMPTY_PROGRESS);
    // 重なりと標準の雀士は一覧から除く
    s.setItem('pujan.progress.v2', JSON.stringify({ ...p, characters: ['standard', 'speed', 'speed'] }));
    expect(loadProgress(s).characters).toEqual(['speed']);
  });

  it('雀士の一覧を持たない前の形（v1）は、条件を満たした雀士を解禁済みとして読む', () => {
    const s = memoryStorage();
    s.setItem('pujan.progress.v1', JSON.stringify({ yakuWon: ['門前'], bestWaves: 2, danCleared: 0 }));
    expect(loadProgress(s).characters).toEqual(['menzen', 'oya', 'speed']);
    // v2 があれば、古い画面が v1 に書き戻したものは読まない
    saveProgress(s, { yakuWon: ['門前'], bestWaves: 2, danCleared: 0, characters: ['speed'] });
    expect(loadProgress(s).characters).toEqual(['speed']);
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

describe('送った感想', () => {
  it('送った順に残し、古いものから捨てる', () => {
    const s = memoryStorage();
    expect(loadSentFeedback(s)).toEqual([]);
    for (let i = 0; i < MAX_SENT_FEEDBACK + 2; i++) addSentFeedback(s, { body: `感想${i}`, sentAt: i, context: 'c' });
    const sent = loadSentFeedback(s);
    expect(sent).toHaveLength(MAX_SENT_FEEDBACK);
    expect(sent[0]?.body).toBe('感想2');
    expect(sent.at(-1)?.body).toBe(`感想${MAX_SENT_FEEDBACK + 1}`);
  });

  it('壊れた中身や形の違うものは読まない', () => {
    const s = memoryStorage();
    s.setItem('pujan.sent-feedback.v1', '{not json');
    expect(loadSentFeedback(s)).toEqual([]);
    s.setItem('pujan.sent-feedback.v1', JSON.stringify([{ body: 'a', sentAt: 1, context: 'c' }, { body: 'b' }, null]));
    expect(loadSentFeedback(s)).toEqual([{ body: 'a', sentAt: 1, context: 'c' }]);
    expect(loadSentFeedback(null)).toEqual([]);
  });
});
