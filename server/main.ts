import { serve } from '@hono/node-server';
import { createLocalApp } from './bootstrap/local.js';

const port = Number.parseInt(process.env.PORT || '3001', 10);

const app = await createLocalApp();

serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    console.log(`Bulk ATR producer listening on http://127.0.0.1:${port}/fhir`);
    console.log(`AUTH_MODE=${process.env.AUTH_MODE || 'none'}`);
  },
);
