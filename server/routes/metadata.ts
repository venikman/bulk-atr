import { Hono } from 'hono';
import type { AppEnv, AuthMode } from '../lib/auth.js';
import { createCapabilityStatement } from '../lib/capability-statement.js';
import { fhirJson } from '../lib/operation-outcome.js';

export const createMetadataRoutes = (authMode: AuthMode) => {
  const app = new Hono<AppEnv>();

  app.get('/metadata', (context) => {
    const origin = new URL(context.req.url).origin;
    const statement = createCapabilityStatement(`${origin}/fhir`, authMode);
    return fhirJson(context, statement);
  });

  return app;
};
