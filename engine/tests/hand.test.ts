import { describe, expect, it } from 'vitest';
import { evaluateFive, evaluateSix, type HandRules } from '../src/hand.js';
import { CHUN, EAST, HAKU, HATSU, NORTH, SOUTH, WEST } from '../src/tiles.js';

// 萬子 m(1..9) = 0..8、筒子 p = 9..17、索子 s = 18..26
const m = (n: number) => n - 1;
const p = (n: number) => 8 + n;
const s = (n: number) => 17 + n;

const rules: HandRules = { bakaze: EAST, seat: SOUTH };
const names = (kinds: number[], r: HandRules = rules) => evaluateFive(kinds, r)?.yaku.map((y) => y.name) ?? null;

describe('evaluateFive', () => {
  it('対子＋順子は和了形（役なし）', () => {
    const ev = evaluateFive([m(1), m(1), p(3), p(4), p(5)], rules)!;
    expect(ev.noYaku).toBe(true);
    expect(ev.han).toBe(0);
  });

  it('和了形でなければ null', () => {
    expect(evaluateFive([m(1), m(2), m(4), p(1), s(9)], rules)).toBeNull();
  });

  it('断么九と清一色が複合する', () => {
    expect(names([m(2), m(2), m(3), m(4), m(5)])).toEqual(['断么九', '清一色']);
  });

  it('プチ三色（同じ数字の3色＋対子）', () => {
    expect(names([m(3), p(3), s(3), m(8), m(8)])).toEqual(['断么九', 'プチ三色']);
  });

  it('プチ一通は同色の5連', () => {
    const ev = evaluateFive([m(1), m(2), m(3), m(4), m(5)], rules)!;
    expect(ev.yaku.map((y) => y.name)).toEqual(['清一色', 'プチ一通']);
    expect(ev.han).toBe(5);
  });

  it('147 は役にならない（飛び石なし）', () => {
    expect(evaluateFive([m(1), m(4), m(7), p(2), p(2)], rules)).toBeNull();
  });

  it('飛び石があると 147 が順子になる', () => {
    expect(evaluateFive([m(1), m(4), m(7), p(2), p(2)], { ...rules, skipSequences: true })).not.toBeNull();
  });

  it('色眼鏡で萬子と索子をまたぐ順子と清一色', () => {
    const r = { ...rules, sameColorManSou: true };
    expect(names([m(2), s(3), m(4), m(6), m(6)], r)).toEqual(['断么九', '清一色']);
  });

  it('プチ国士（三元牌・風牌・1・9 を1枚ずつ＋対子）', () => {
    expect(names([HAKU, EAST, m(1), p(9), p(9)])).toContain('プチ国士');
  });

  it('プチ小三元とプチ大三元', () => {
    expect(names([HAKU, HATSU, CHUN, m(6), m(6)])).toEqual(['混一色', 'プチ小三元']);
    const ev = evaluateFive([CHUN, CHUN, CHUN, HAKU, HATSU], rules)!;
    expect(ev.yakuman).toBe(3); // ダブル役満＋字一色
  });

  it('プチ小四喜とプチ大四喜', () => {
    expect(names([EAST, SOUTH, WEST, m(6), m(6)])).toContain('プチ小四喜');
    expect(evaluateFive([EAST, SOUTH, WEST, NORTH, HAKU], rules)!.yakuman).toBe(2); // 大四喜＋字一色
  });

  it('プチ槓は役満', () => {
    const ev = evaluateFive([m(6), m(6), m(6), m(6), NORTH], rules)!;
    expect(ev.yaku.map((y) => y.name)).toEqual(['プチ槓']);
  });

  it('役牌: 場風と自風が重なるとダブル', () => {
    const dealer = { bakaze: EAST, seat: EAST };
    const ev = evaluateFive([EAST, EAST, p(2), p(3), p(4)], dealer)!;
    expect(ev.yaku.find((y) => y.name === '役牌')!.han).toBe(2);
  });

  it('風見鶏ですべての風牌が役牌', () => {
    expect(names([WEST, WEST, p(2), p(3), p(4)])).not.toContain('役牌');
    expect(names([WEST, WEST, p(2), p(3), p(4)], { ...rules, allWindsYakuhai: true })).toContain('役牌');
  });

  it('緑一色', () => {
    expect(evaluateFive([s(2), s(3), s(4), HATSU, HATSU], rules)!.yaku.map((y) => y.name)).toEqual(['緑一色']);
  });
});

describe('evaluateSix', () => {
  it('三対子と一色系が複合する', () => {
    const ev = evaluateSix([m(2), m(2), m(6), m(6), m(8), m(8)], rules)!;
    expect(ev.yaku.map((y) => y.name)).toEqual(['三対子', '断么九', '清一色']);
  });

  it('字牌だけの三対子は役満', () => {
    expect(evaluateSix([EAST, EAST, HAKU, HAKU, CHUN, CHUN], rules)!.yakuman).toBe(1);
  });

  it('対子3組でなければ null', () => {
    expect(evaluateSix([m(2), m(2), m(2), m(2), m(8), m(8)], rules)).toBeNull();
  });
});
