/** Bindings and vars come from wrangler.jsonc (`npm run cf-typegen -w backend` writes worker-configuration.d.ts) */
export type Bindings = Env;

export type Variables = {
  /** 要求の Cookie の kan-game.app の ID（middleware/auth.ts） */
  accountId: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
