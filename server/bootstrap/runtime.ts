import { Pool } from 'pg';
import claimsAttributionSource from '../../data/sources/claims-attribution-service.json' with {
  type: 'json',
};
import memberCoverageSource from '../../data/sources/member-coverage-service.json' with {
  type: 'json',
};
import providerDirectorySource from '../../data/sources/provider-directory-service.json' with {
  type: 'json',
};
import {
  ensureExportArtifactSchema,
  PostgresExportArtifactStore,
} from '../adapters/postgres-export-artifact-store.js';
import {
  ensureExportJobSchema,
  PostgresExportJobRepository,
} from '../adapters/postgres-export-job-repository.js';
import { createApp } from '../app.js';
import { AtrResolver } from '../lib/atr-resolver.js';
import { type AuthMode, normalizeAuthMode } from '../lib/auth.js';
import type { BackgroundTaskRunner } from '../lib/background-task-runner.js';
import { createRawDomainStoreFromDocuments } from '../lib/raw-domain-store.js';
import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
} from '../lib/raw-domain-types.js';

export const resolveConnectionString = () => {
  const value = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!value) {
    throw new Error('POSTGRES_URL or DATABASE_URL must be configured for the runtime app.');
  }

  return value;
};

export const createRuntimePool = (connectionString = resolveConnectionString()) =>
  new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 1,
  });

export type CreateRuntimeAppOptions = {
  authMode?: AuthMode;
  backgroundTaskRunner: BackgroundTaskRunner;
  jobDelayMs?: number;
  pool: Pool;
};

export const createRuntimeApp = async ({
  authMode = normalizeAuthMode(process.env.AUTH_MODE),
  backgroundTaskRunner,
  jobDelayMs = 50,
  pool,
}: CreateRuntimeAppOptions) => {
  await ensureExportJobSchema(pool);
  await ensureExportArtifactSchema(pool);

  const rawDomainStore = createRawDomainStoreFromDocuments({
    memberCoverage: memberCoverageSource as MemberCoverageSourceDocument,
    providerDirectory: providerDirectorySource as ProviderDirectorySourceDocument,
    claimsAttribution: claimsAttributionSource as ClaimsAttributionSourceDocument,
  });
  const jobRepository = new PostgresExportJobRepository(pool);
  const artifactStore = new PostgresExportArtifactStore(pool);

  return createApp({
    authMode,
    resolver: new AtrResolver(rawDomainStore),
    artifactStore,
    jobRepository,
    backgroundTaskRunner,
    jobDelayMs,
  });
};
