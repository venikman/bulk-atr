import { newDb } from 'pg-mem';
import { createLocalApp } from '../../server/bootstrap/local.js';

type CapabilityStatementPayload = {
  resourceType: string;
};

type BundlePayload = {
  resourceType: string;
  total: number;
};

describe('local bootstrap', () => {
  test('creates a production-like local app that preserves the current fhir surface', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const app = await createLocalApp({ pool });

    try {
      const metadata = await app.request('http://example.test/fhir/metadata');
      const metadataBody = (await metadata.json()) as CapabilityStatementPayload;

      expect(metadata.status).toBe(200);
      expect(metadataBody.resourceType).toBe('CapabilityStatement');

      const groupSearch = await app.request(
        'http://example.test/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&_summary=true',
      );
      const groupBody = (await groupSearch.json()) as BundlePayload;

      expect(groupSearch.status).toBe(200);
      expect(groupBody.resourceType).toBe('Bundle');
      expect(groupBody.total).toBe(1);

      const kickoff = await app.request(
        'http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage',
      );

      expect(kickoff.status).toBe(202);
      expect(kickoff.headers.get('content-location')).toContain('/fhir/bulk-status/');
    } finally {
      await pool.end();
    }
  });
});
