import { resolve } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, AuthMode } from './lib/auth.js';
import { ExportJobStore } from './lib/export-jobs.js';
import { FileStore } from './lib/file-store.js';
import { ProjectionStore } from './lib/projection-store.js';
import { createBulkRoutes } from './routes/bulk.js';
import { createGroupRoutes } from './routes/group.js';
import { createMetadataRoutes } from './routes/metadata.js';
import { createResourceReadRoutes } from './routes/resource-read.js';

export type AppOptions = {
  authMode?: AuthMode;
  runtimeDir?: string;
  fixturePath?: string;
  jobDelayMs?: number;
};

export const createApp = async ({
  authMode = (process.env.AUTH_MODE as AuthMode | undefined) || 'none',
  runtimeDir = resolve('.runtime/atr'),
  fixturePath = resolve('output/atr_bulk_export_single.json'),
  jobDelayMs = 50,
}: AppOptions = {}) => {
  const projectionStore = await ProjectionStore.load(fixturePath);
  const fileStore = new FileStore(runtimeDir);
  await fileStore.init();
  const jobStore = new ExportJobStore(runtimeDir);
  await jobStore.init();

  const app = new Hono<AppEnv>();
  const fhir = new Hono<AppEnv>();

  fhir.route('/', createMetadataRoutes(authMode));
  fhir.route('/', createGroupRoutes({ projectionStore, authMode }));
  fhir.route(
    '/',
    createBulkRoutes({
      projectionStore,
      jobStore,
      fileStore,
      authMode,
      jobDelayMs,
    }),
  );
  fhir.route('/', createResourceReadRoutes({ projectionStore, authMode }));

  app.route('/fhir', fhir);

  return app;
};
