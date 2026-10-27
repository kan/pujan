import { describe, expect, it } from 'vitest';
import { importVerificationKeys, verifyIdCookie, verifyIdToken, type IdTokenClaims } from '../src/lib/id-token';
import vectors from './kan-game/id-token-vectors.json';

/*
 * kan/game の src/token.ts の写し（src/lib/id-token.ts）を、kan/game の test-vectors/id-token.json
 * （test/kan-game/id-token-vectors.json）で、kan/game の test/vectors.test.ts と同じ照合をする。
 * 2 つは一緒に写し直す（kan/game docs/ID_DESIGN.md「鍵の管理」）。
 */
const keys = await importVerificationKeys(JSON.stringify(vectors.keys));

describe('test vectors: tokens', () => {
  it.each(vectors.tokens)('$name', async ({ token, expected }) => {
    const claims: IdTokenClaims | null = await verifyIdToken(token, keys, vectors.issuer, vectors.now);
    expect(claims).toEqual(expected);
  });
});

describe('test vectors: cookie headers', () => {
  it.each(vectors.cookies)('$name', async ({ header, expected }) => {
    const claims = await verifyIdCookie(header, vectors.cookieName, keys, vectors.issuer, vectors.now);
    expect(claims?.sub ?? null).toBe(expected);
  });
});
