import { resolve } from 'node:path';
import { LocalBackgroundTaskRunner } from '../adapters/local-background-task-runner.js';
import { createApp } from '../app.js';
import { type AuthMode, normalizeAuthMode } from '../lib/auth.js';
import { ExportJobStore } from '../lib/export-jobs.js';
import { FileStore } from '../lib/file-store.js';
import { ProjectionStore } from '../lib/projection-store.js';

export type CreateLocalAppOptions = {
  authMode?: AuthMode;
  runtimeDir?: string;
  fixturePath?: string;
  jobDelayMs?: number;
};

export const createLocalApp = async ({
  authMode = normalizeAuthMode(process.env.AUTH_MODE),
  runtimeDir = resolve('.runtime/atr'),
  fixturePath = resolve('output/atr_bulk_export_single.json'),
  jobDelayMs = 50,
}: CreateLocalAppOptions = {}) => {
  const projectionStore = await ProjectionStore.load(fixturePath);
  const artifactStore = new FileStore(runtimeDir);
  await artifactStore.init();
  const jobRepository = new ExportJobStore(runtimeDir);
  await jobRepository.init();

  return createApp({
    authMode,
    projectionStore,
    artifactStore,
    jobRepository,
    backgroundTaskRunner: new LocalBackgroundTaskRunner(),
    jobDelayMs,
  });
};
