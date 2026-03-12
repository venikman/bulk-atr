import type { Pool } from 'pg';
import { LocalBackgroundTaskRunner } from '../adapters/local-background-task-runner.js';
import { type AuthMode, normalizeAuthMode } from '../lib/auth.js';
import { createRuntimeApp, createRuntimePool } from './runtime.js';

export type CreateLocalAppOptions = {
  authMode?: AuthMode;
  jobDelayMs?: number;
  pool?: Pool;
};

export const createLocalApp = async ({
  authMode = normalizeAuthMode(process.env.AUTH_MODE),
  jobDelayMs = 50,
  pool,
}: CreateLocalAppOptions = {}) =>
  createRuntimeApp({
    authMode,
    backgroundTaskRunner: new LocalBackgroundTaskRunner(),
    jobDelayMs,
    pool: pool ?? createRuntimePool(),
  });
