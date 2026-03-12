import { setTimeout as delay } from 'node:timers/promises';
import { newDb } from 'pg-mem';
import {
  ensureExportArtifactSchema,
  PostgresExportArtifactStore,
} from '../../server/adapters/postgres-export-artifact-store.js';
import {
  ensureExportJobSchema,
  PostgresExportJobRepository,
} from '../../server/adapters/postgres-export-job-repository.js';
import { createApp } from '../../server/app.js';
import { AtrResolver } from '../../server/lib/atr-resolver.js';
import type { BackgroundTaskRunner } from '../../server/lib/background-task-runner.js';
import { loadRawDomainStore } from '../../server/lib/raw-domain-store.js';

class TestBackgroundTaskRunner implements BackgroundTaskRunner {
  readonly tasks = new Set<Promise<void>>();

  run(task: () => Promise<void>, delayMs = 0) {
    const scheduled = (async () => {
      if (delayMs > 0) {
        await delay(delayMs);
      }

      await task();
    })();

    this.tasks.add(scheduled);
    void scheduled.finally(() => {
      this.tasks.delete(scheduled);
    });
  }

  async waitForIdle() {
    await Promise.allSettled([...this.tasks]);
  }
}

export const createTestServer = async (authMode: 'none' | 'smart-backend' = 'none') => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await ensureExportJobSchema(pool);
  await ensureExportArtifactSchema(pool);

  const rawDomainStore = await loadRawDomainStore({
    memberCoveragePath: 'data/sources/member-coverage-service.json',
    providerDirectoryPath: 'data/sources/provider-directory-service.json',
    claimsAttributionPath: 'data/sources/claims-attribution-service.json',
  });
  const backgroundTaskRunner = new TestBackgroundTaskRunner();
  const jobRepository = new PostgresExportJobRepository(pool);
  const artifactStore = new PostgresExportArtifactStore(pool);
  const app = createApp({
    authMode,
    resolver: new AtrResolver(rawDomainStore),
    artifactStore,
    jobRepository,
    backgroundTaskRunner,
  });

  const request = (path: string, init?: RequestInit) => {
    const url =
      path.startsWith('http://') || path.startsWith('https://')
        ? path
        : `http://example.test${path}`;
    return app.request(new Request(url, init));
  };

  const cleanup = async () => {
    await backgroundTaskRunner.waitForIdle();
    await pool.end();
  };

  return { app, request, cleanup, pool, jobRepository, artifactStore };
};
