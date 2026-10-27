import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// vegtab の backend/vitest.config.ts と同じ形。テストは Workers のランタイムで、本物のマイグレーションを当てた D1 で動く
export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    resolve: {
      // `wrangler deploy` と同じく engine のソースを使う（古いかもしれない dist ではなく）
      alias: {
        '@pujan/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      },
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)) },
        miniflare: {
          d1Databases: ['DB'],
          // wrangler.jsonc は ID を kan/game のローカルの Worker につなぐが、テストでは動かさない。
          // テストは偽の ID 基盤で Worker を呼ぶ（test/helpers.ts の call）
          serviceBindings: { ID: () => new Response('ID platform not in tests', { status: 500 }) },
          bindings: {
            ENVIRONMENT: 'test',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
