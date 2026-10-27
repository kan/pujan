/**
 * ラン全体を 1 つの状態として進める。仕様は docs/SPEC.md §5.3「不正対策」。
 *
 * 画面もサーバーも、プレイヤーの操作（GameAction）を apply() に順に与えて状態を進める。
 * 操作の列とシードと基本ルールを並べたものが操作ログ（RunLog）で、replay() で同じ結果を作り直せる。
 * 乱数はすべて状態に入っているので、同じログからは必ず同じ結果になる。
 */
import { DEFAULT_BASE_RULES, type BaseRules, type Loadout } from './items.js';
import { step, type KyokuMove, type KyokuState } from './kyoku.js';
import {
  beginKyoku,
  buy,
  consumeConsumable,
  createRun,
  leaveShop,
  reroll,
  sellCharm,
  settleKyoku,
  type RunState,
} from './run.js';
import type { Kind } from './tiles.js';

/**
 * エンジンの版。同じ操作ログから違う結果になる変更（役・点数・乱数の使い方・ショップなど）をしたら 1 つ上げる。
 * サーバーは記録の版と今の版が違うログを再生で検証できない（§5.3）。
 */
export const ENGINE_VERSION = 1;

/** プレイヤーの操作 */
export type GameAction =
  /** 局の中の操作（打牌・保留・リーチ・和了・配牌の引き直し） */
  | KyokuMove
  /** 持っている消耗品（index 番目）を使う */
  | { type: 'useConsumable'; index: number }
  /** 終わった局を精算する。親の和了では renchan で連荘か和了やめかを選ぶ */
  | { type: 'settle'; renchan?: boolean }
  /** ショップの品物（index 番目）を買う。牌の改造は対象の種類（target）が要る */
  | { type: 'buy'; index: number; target?: Kind }
  /** 持っているお守り（index 番目）を売る */
  | { type: 'sell'; index: number }
  | { type: 'reroll' }
  /** ショップを出て次の局へ進む */
  | { type: 'leave' };

export interface GameState {
  run: RunState;
  /** 進行中の局（ショップやランの終了後は null） */
  kyoku: KyokuState | null;
  /** 直前に精算した局（ショップや場の結果の後ろに、終わった局を表示するため） */
  previous: KyokuState | null;
}

export interface RunLog {
  engineVersion: number;
  seed: number;
  base: BaseRules;
  actions: GameAction[];
}

/** ラン終了（over）と全場クリア（cleared） */
export const isFinished = (g: GameState): boolean => g.run.phase === 'over' || g.run.phase === 'cleared';

const withKyoku = (run: RunState, previous: KyokuState | null): GameState =>
  run.phase === 'kyoku' ? { ...beginKyoku(run), previous } : { run, kyoku: null, previous };

/** 新しいラン。start は最初から持つお守りと設備（createRun を参照） */
export function createGame(seed: number, base: BaseRules = DEFAULT_BASE_RULES, start?: Loadout): GameState {
  return withKyoku(createRun(seed, base, start), null);
}

function activeKyoku(g: GameState): KyokuState {
  if (!g.kyoku) throw new Error('no kyoku in progress');
  return g.kyoku;
}

function inShop(g: GameState): RunState {
  if (g.run.phase !== 'shop') throw new Error('not in the shop');
  return g.run;
}

/** 操作を 1 つ適用した新しい状態を返す。できない操作なら例外を投げる */
export function apply(g: GameState, action: GameAction): GameState {
  if (isFinished(g)) throw new Error('run has finished');
  switch (action.type) {
    case 'discard':
    case 'hold':
    case 'riichi':
    case 'tsumo':
    case 'redeal':
      return { ...g, kyoku: step(activeKyoku(g), action) };
    case 'useConsumable': {
      // consumeConsumable が番号を確かめてから、その消耗品を局で使う
      const run = consumeConsumable(g.run, action.index);
      const id = g.run.consumables[action.index];
      return { ...g, run, kyoku: step(activeKyoku(g), { type: 'consumable', id }) };
    }
    case 'settle': {
      const result = activeKyoku(g).result;
      if (!result) throw new Error('kyoku has not ended');
      return { run: settleKyoku(g.run, result, action.renchan ?? false), kyoku: null, previous: g.kyoku };
    }
    case 'buy':
      return { ...g, run: buy(inShop(g), action.index, action.target) };
    case 'sell':
      return { ...g, run: sellCharm(inShop(g), action.index) };
    case 'reroll':
      return { ...g, run: reroll(inShop(g)) };
    case 'leave':
      return withKyoku(leaveShop(inShop(g)), g.previous);
    default:
      // ログの操作は信頼できない入力なので、知らない種類（局の 'consumable' を直接送るなど）は拒む
      throw new Error(`unknown action: ${(action as { type: unknown }).type}`);
  }
}

export function newLog(seed: number, base: BaseRules = DEFAULT_BASE_RULES): RunLog {
  return { engineVersion: ENGINE_VERSION, seed, base, actions: [] };
}

/**
 * 操作ログを再生して、最後の状態を返す。版が違うログや、途中にできない操作があるログは例外を投げる。
 * ランが終わる前で止まっているログ（途中のラン）も再生できる。
 */
export function replay(log: RunLog): GameState {
  if (log.engineVersion !== ENGINE_VERSION) {
    throw new Error(`engine version mismatch: log ${log.engineVersion}, engine ${ENGINE_VERSION}`);
  }
  let g = createGame(log.seed, log.base);
  log.actions.forEach((a, i) => {
    try {
      g = apply(g, a);
    } catch (e) {
      throw new Error(`action ${i} (${a.type}): ${(e as Error).message}`);
    }
  });
  return g;
}
