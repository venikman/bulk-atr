import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApp } from '../../server/bootstrap/local.js';

export const createTestServer = async (authMode: 'none' | 'smart-backend' = 'none') => {
  const runtimeDir = await mkdtemp(join(tmpdir(), 'bulk-atr-'));
  const app = await createLocalApp({
    authMode,
    runtimeDir,
  });

  const request = (path: string, init?: RequestInit) => {
    const url =
      path.startsWith('http://') || path.startsWith('https://')
        ? path
        : `http://example.test${path}`;
    return app.request(new Request(url, init));
  };

  const cleanup = async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  };

  return { app, request, runtimeDir, cleanup };
};
