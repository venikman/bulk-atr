import { Hono } from 'hono';
import type { AppEnv, AuthMode } from './lib/auth.js';
import type { BackgroundTaskRunner } from './lib/background-task-runner.js';
import type { ExportArtifactStore } from './lib/export-artifact-store.js';
import type { ExportJobRepository } from './lib/export-job-repository.js';
import type { ProjectionStore } from './lib/projection-store.js';
import { createBulkRoutes } from './routes/bulk.js';
import { createGroupRoutes } from './routes/group.js';
import { createMetadataRoutes } from './routes/metadata.js';
import { createResourceReadRoutes } from './routes/resource-read.js';

export type AppOptions = {
  authMode?: AuthMode;
  projectionStore: ProjectionStore;
  artifactStore: ExportArtifactStore;
  jobRepository: ExportJobRepository;
  backgroundTaskRunner: BackgroundTaskRunner;
  jobDelayMs?: number;
};

export const createApp = ({
  authMode = (process.env.AUTH_MODE as AuthMode | undefined) || 'none',
  projectionStore,
  artifactStore,
  jobRepository,
  backgroundTaskRunner,
  jobDelayMs = 50,
}: AppOptions) => {
  const app = new Hono<AppEnv>();
  const fhir = new Hono<AppEnv>();

  fhir.route('/', createMetadataRoutes(authMode));
  fhir.route('/', createGroupRoutes({ projectionStore, authMode }));
  fhir.route(
    '/',
    createBulkRoutes({
      projectionStore,
      artifactStore,
      jobRepository,
      backgroundTaskRunner,
      authMode,
      jobDelayMs,
    }),
  );
  fhir.route('/', createResourceReadRoutes({ projectionStore, authMode }));

  app.route('/fhir', fhir);

  return app;
};
