import { Pool } from 'pg';
import atrFixture from '../../output/atr_bulk_export_single.json' with { type: 'json' };
import { BlobExportArtifactStore } from '../adapters/blob-export-artifact-store.js';
import {
  ensureExportJobSchema,
  PostgresExportJobRepository,
} from '../adapters/postgres-export-job-repository.js';
import { VercelBackgroundTaskRunner } from '../adapters/vercel-background-task-runner.js';
import { createApp } from '../app.js';
import { type AuthMode, normalizeAuthMode } from '../lib/auth.js';
import { ProjectionStore } from '../lib/projection-store.js';

let poolPromise: Promise<Pool> | null = null;

const resolveConnectionString = () => {
  const value = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!value) {
    throw new Error('POSTGRES_URL or DATABASE_URL must be configured for the Vercel app.');
  }

  return value;
};

const getPool = async () => {
  if (!poolPromise) {
    poolPromise = (async () => {
      const pool = new Pool({
        connectionString: resolveConnectionString(),
        ssl: {
          rejectUnauthorized: false,
        },
        max: 1,
      });

      await ensureExportJobSchema(pool);
      return pool;
    })();
  }

  return poolPromise;
};

export const createVercelApp = async ({
  authMode = normalizeAuthMode(process.env.AUTH_MODE),
  jobDelayMs = 50,
  blobPrefix = 'bulk-atr',
}: {
  authMode?: AuthMode;
  jobDelayMs?: number;
  blobPrefix?: string;
} = {}) => {
  const projectionStore = ProjectionStore.fromFixtureDocument(
    atrFixture as { resources: Record<string, unknown> },
  );
  const jobRepository = new PostgresExportJobRepository(await getPool());
  const artifactStore = new BlobExportArtifactStore({
    prefix: blobPrefix,
  });

  return createApp({
    authMode,
    projectionStore,
    artifactStore,
    jobRepository,
    backgroundTaskRunner: new VercelBackgroundTaskRunner(),
    jobDelayMs,
  });
};
