import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Bindings } from '../src/types';
import { createTestIdIssuer } from './kan-game/test-id-cookie';
import { createFakeIdPlatform, type FakeIdPlatform } from './kan-game/fake-id-platform';

/** テストの Cookie に署名する。その鍵だけを ID_PUBLIC_KEYS に置く（call を参照） */
export const idIssuer = await createTestIdIssuer({ issuer: 'test.kan-game.app', cookieName: '__Secure-kgtest_id' });

/** ID 基盤の RPC（ID binding）。resetDb で作り直す */
export let idPlatform: FakeIdPlatform = createFakeIdPlatform();

/** テストで API が受け付けるオリジン（wrangler.jsonc の最上位の ALLOWED_ORIGINS） */
export const ORIGIN = 'http://localhost:5173';

export function testEnv(): Bindings {
  return {
    ...(env as unknown as Bindings),
    ID: idPlatform.rpc as unknown as Bindings['ID'],
    ID_PUBLIC_KEYS: idIssuer.publicKeys,
    ID_ISSUER: idIssuer.issuer,
    ID_COOKIE_NAME: idIssuer.cookieName,
  };
}

/** テストの ID の設定（偽の ID 基盤とテストの鍵）で Worker を呼ぶ */
export async function call(path: string, init?: RequestInit, overrides: Partial<Bindings> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://localhost${path}`, init), { ...testEnv(), ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** 各テストを空の表から始める（表の形は test/apply-migrations.ts が作る） */
export async function resetDb() {
  for (const table of ['runs', 'weekly_best', 'profiles', 'deleted_accounts']) await env.DB.exec(`DELETE FROM ${table}`);
  idPlatform = createFakeIdPlatform();
}

export interface TestUser {
  id: string;
  /** 許可したオリジンからの、その ID の Cookie つきの要求のヘッダー */
  headers: Record<string, string>;
}

/** 新しい kan-game.app の ID。name を渡すと、名前を登録してここでの公開に同意した ID（ランキングに載る） */
export async function newUser(options: { name?: string } = {}): Promise<TestUser> {
  const id = crypto.randomUUID();
  if (options.name) {
    idPlatform.setName(id, options.name);
    await env.DB.prepare('INSERT INTO profiles (account_id, display_name, consented_at) VALUES (?, ?, ?)')
      .bind(id, options.name, Date.now())
      .run();
  }
  return { id, headers: { Cookie: await idIssuer.cookie(id), Origin: ORIGIN, 'Content-Type': 'application/json' } };
}

export const post = (path: string, user: TestUser, body?: unknown) =>
  call(path, { method: 'POST', headers: user.headers, body: body === undefined ? undefined : JSON.stringify(body) });

export const get = (path: string, user: TestUser) => call(path, { headers: user.headers });
