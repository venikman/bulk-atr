import { Hono } from 'hono';
import type { AtrResolver } from './lib/atr-resolver.js';
import { type AppEnv, type AuthMode, normalizeAuthMode } from './lib/auth.js';
import type { BackgroundTaskRunner } from './lib/background-task-runner.js';
import type { ExportArtifactStore } from './lib/export-artifact-store.js';
import type { ExportJobRepository } from './lib/export-job-repository.js';
import { createBulkRoutes } from './routes/bulk.js';
import { createGroupRoutes } from './routes/group.js';
import { createMetadataRoutes } from './routes/metadata.js';
import { createResourceReadRoutes } from './routes/resource-read.js';

export type AppOptions = {
  authMode?: AuthMode;
  resolver: AtrResolver;
  artifactStore: ExportArtifactStore;
  jobRepository: ExportJobRepository;
  backgroundTaskRunner: BackgroundTaskRunner;
  jobDelayMs?: number;
};

export const createApp = ({
  authMode = normalizeAuthMode(process.env.AUTH_MODE),
  resolver,
  artifactStore,
  jobRepository,
  backgroundTaskRunner,
  jobDelayMs = 50,
}: AppOptions) => {
  const app = new Hono<AppEnv>();
  const fhir = new Hono<AppEnv>();

  fhir.route('/', createMetadataRoutes(authMode));
  fhir.route('/', createGroupRoutes({ resolver, authMode }));
  fhir.route(
    '/',
    createBulkRoutes({
      resolver,
      artifactStore,
      jobRepository,
      backgroundTaskRunner,
      authMode,
      jobDelayMs,
    }),
  );
  fhir.route('/', createResourceReadRoutes({ resolver, authMode }));

  app.route('/fhir', fhir);

  return app;
};
