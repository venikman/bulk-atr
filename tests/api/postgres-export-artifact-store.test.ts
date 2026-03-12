import { newDb } from 'pg-mem';
import {
  ensureExportArtifactSchema,
  PostgresExportArtifactStore,
} from '../../server/adapters/postgres-export-artifact-store.js';

const createStore = async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await ensureExportArtifactSchema(pool);

  return {
    pool,
    store: new PostgresExportArtifactStore(pool),
  };
};

describe('PostgresExportArtifactStore', () => {
  test('writes and reads stored manifests using stable logical keys', async () => {
    const { store } = await createStore();

    const key = await store.writeManifest('11111111-1111-4111-8111-111111111111', {
      transactionTime: '2026-03-11T12:00:00.000Z',
      request: 'http://example.test/fhir/Group/test/$davinci-data-export',
      requiresAccessToken: false,
      output: [
        {
          type: 'Patient',
          fileName: 'Patient-1.ndjson',
        },
      ],
      error: [],
    });

    expect(key).toBe('manifests/11111111-1111-4111-8111-111111111111.json');
    await expect(store.readManifest(key)).resolves.toEqual({
      transactionTime: '2026-03-11T12:00:00.000Z',
      request: 'http://example.test/fhir/Group/test/$davinci-data-export',
      requiresAccessToken: false,
      output: [
        {
          type: 'Patient',
          fileName: 'Patient-1.ndjson',
        },
      ],
      error: [],
    });
  });

  test('writes ndjson payloads with trailing newlines and reads them back by stable keys', async () => {
    const { store } = await createStore();

    const key = await store.writeNdjson(
      '11111111-1111-4111-8111-111111111111',
      'Patient-1.ndjson',
      [
        {
          resourceType: 'Patient',
          id: 'patient-0001',
        },
        {
          resourceType: 'Patient',
          id: 'patient-0002',
        },
      ],
    );

    expect(key).toBe('files/11111111-1111-4111-8111-111111111111/Patient-1.ndjson');
    await expect(store.readNdjson(key)).resolves.toBe(
      [
        JSON.stringify({
          resourceType: 'Patient',
          id: 'patient-0001',
        }),
        JSON.stringify({
          resourceType: 'Patient',
          id: 'patient-0002',
        }),
        '',
      ].join('\n'),
    );
  });

  test('throws when a requested artifact key does not exist', async () => {
    const { store } = await createStore();

    await expect(store.readNdjson('files/job-1/missing.ndjson')).rejects.toThrow(
      'Postgres artifact was not found.',
    );
  });
});
