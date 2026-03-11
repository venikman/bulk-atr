import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT || '3001', 10);

const app = await createApp();

serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    console.log(`ATR producer server listening on http://localhost:${port}/fhir`);
    console.log(`AUTH_MODE=${process.env.AUTH_MODE || 'none'}`);
  },
);
