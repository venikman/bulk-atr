import { join, resolve } from 'node:path';
import { LocalBackgroundTaskRunner } from '../adapters/local-background-task-runner.js';
import { createApp } from '../app.js';
import { AtrResolver } from '../lib/atr-resolver.js';
import { type AuthMode, normalizeAuthMode } from '../lib/auth.js';
import { ExportJobStore } from '../lib/export-jobs.js';
import { FileStore } from '../lib/file-store.js';
import { loadRawDomainStore } from '../lib/raw-domain-store.js';

export type CreateLocalAppOptions = {
  authMode?: AuthMode;
  runtimeDir?: string;
  sourceDir?: string;
  memberCoveragePath?: string;
  providerDirectoryPath?: string;
  claimsAttributionPath?: string;
  jobDelayMs?: number;
};

export const createLocalApp = async ({
  authMode = normalizeAuthMode(process.env.AUTH_MODE),
  runtimeDir = resolve('.runtime/atr'),
  sourceDir = resolve('input-services'),
  memberCoveragePath = join(sourceDir, 'member-coverage-service.json'),
  providerDirectoryPath = join(sourceDir, 'provider-directory-service.json'),
  claimsAttributionPath = join(sourceDir, 'claims-attribution-service.json'),
  jobDelayMs = 50,
}: CreateLocalAppOptions = {}) => {
  const rawDomainStore = await loadRawDomainStore({
    memberCoveragePath,
    providerDirectoryPath,
    claimsAttributionPath,
  });
  const artifactStore = new FileStore(runtimeDir);
  await artifactStore.init();
  const jobRepository = new ExportJobStore(runtimeDir);
  await jobRepository.init();

  return createApp({
    authMode,
    resolver: new AtrResolver(rawDomainStore),
    artifactStore,
    jobRepository,
    backgroundTaskRunner: new LocalBackgroundTaskRunner(),
    jobDelayMs,
  });
};
