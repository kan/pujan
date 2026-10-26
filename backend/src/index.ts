import { Hono } from 'hono';
import type { Bindings } from './types';

const app = new Hono<{ Bindings: Bindings }>();

// kan-game.app の ID の API を、このオリジンのものとして中継する（kan/game docs/ID_DESIGN.md「HTTP の API」）
app.all('/api/id/*', async (c) => {
  try {
    return await c.env.ID.fetch(c.req.raw);
  } catch (error) {
    console.error(JSON.stringify({ event: 'id_proxy_failure', error: String(error) }));
    return c.json({ error: 'service_unavailable' }, 503);
  }
});

app.get('/api/health', (c) => c.json({ status: 'ok' }));

// TODO: ランの記録・デイリーシード・ランキング（docs/SPEC.md §5、§6 フェーズ 3）

export default app;
