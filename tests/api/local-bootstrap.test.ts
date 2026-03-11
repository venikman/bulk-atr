import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApp } from '../../server/bootstrap/local.js';

describe('local bootstrap', () => {
  test('creates an app that preserves the current bulk export flow', async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), 'bulk-atr-local-'));

    try {
      const app = await createLocalApp({
        runtimeDir,
      });

      const kickoff = await app.request(
        new Request(
          'http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage',
        ),
      );

      expect(kickoff.status).toBe(202);
      expect(kickoff.headers.get('content-location')).toContain('/fhir/bulk-status/');
    } finally {
      await rm(runtimeDir, { recursive: true, force: true });
    }
  });
});
