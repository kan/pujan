import { WorkerEntrypoint } from 'cloudflare:workers';
import type { GameService as GameServiceContract } from './lib/id-rpc';
import type { Bindings } from './types';
import { deleteAccount } from './lib/account';

/**
 * Pu-Jan が kan-game.app の ID 基盤に提供するもの。ID 基盤は GAME_PUJAN として binding する
 * （kan/game docs/ID_DESIGN.md「ゲームとの RPC」）。名前付きの entrypoint なので、binding からは
 * このメソッドだけに届き、HTTP の API には届かない。
 */
export class GameService extends WorkerEntrypoint<Bindings> implements GameServiceContract {
  /** 退会: ID を削除済みとして残し、記録を消す */
  async deleteAccount(id: string): Promise<void> {
    if (typeof id !== 'string' || id === '') throw new Error('invalid id');
    await deleteAccount(this.env.DB, id);
  }
}
