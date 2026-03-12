import type { Pool } from 'pg';
import { VercelBackgroundTaskRunner } from '../adapters/vercel-background-task-runner.js';
import { type AuthMode, normalizeAuthMode } from '../lib/auth.js';
import { createRuntimeApp, createRuntimePool, resolveConnectionString } from './runtime.js';

let poolPromise: Promise<Pool> | null = null;

const getPool = async () => {
  if (!poolPromise) {
    poolPromise = Promise.resolve(createRuntimePool(resolveConnectionString()));
  }

  return poolPromise;
};

export const createVercelApp = async ({
  authMode = normalizeAuthMode(process.env.AUTH_MODE),
  jobDelayMs = 50,
}: {
  authMode?: AuthMode;
  jobDelayMs?: number;
} = {}) =>
  createRuntimeApp({
    authMode,
    backgroundTaskRunner: new VercelBackgroundTaskRunner(),
    jobDelayMs,
    pool: await getPool(),
  });
