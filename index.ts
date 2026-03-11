import { handle } from '@hono/node-server/vercel';
import { createVercelApp } from './server/bootstrap/vercel.js';

const app = await createVercelApp();

export default handle(app);
