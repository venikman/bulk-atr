import { Pool } from 'pg';
import claimsAttributionSource from '../../input-services/claims-attribution-service.json' with {
  type: 'json',
};
import memberCoverageSource from '../../input-services/member-coverage-service.json' with {
  type: 'json',
};
import providerDirectorySource from '../../input-services/provider-directory-service.json' with {
  type: 'json',
};
import { BlobExportArtifactStore } from '../adapters/blob-export-artifact-store.js';
import {
  ensureExportJobSchema,
  PostgresExportJobRepository,
} from '../adapters/postgres-export-job-repository.js';
import { VercelBackgroundTaskRunner } from '../adapters/vercel-background-task-runner.js';
import { createApp } from '../app.js';
import { AtrResolver } from '../lib/atr-resolver.js';
import { type AuthMode, normalizeAuthMode } from '../lib/auth.js';
import { createRawDomainStoreFromDocuments } from '../lib/raw-domain-store.js';
import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
} from '../lib/raw-domain-types.js';

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
  const rawDomainStore = createRawDomainStoreFromDocuments({
    memberCoverage: memberCoverageSource as MemberCoverageSourceDocument,
    providerDirectory: providerDirectorySource as ProviderDirectorySourceDocument,
    claimsAttribution: claimsAttributionSource as ClaimsAttributionSourceDocument,
  });
  const jobRepository = new PostgresExportJobRepository(await getPool());
  const artifactStore = new BlobExportArtifactStore({
    prefix: blobPrefix,
  });

  return createApp({
    authMode,
    resolver: new AtrResolver(rawDomainStore),
    artifactStore,
    jobRepository,
    backgroundTaskRunner: new VercelBackgroundTaskRunner(),
    jobDelayMs,
  });
};
