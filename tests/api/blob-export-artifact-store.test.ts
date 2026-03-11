import { BlobExportArtifactStore } from '../../server/adapters/blob-export-artifact-store.js';

type StoredObject = {
  body: string;
  contentType: string;
};

const createMemoryBlobClient = () => {
  const objects = new Map<string, StoredObject>();

  return {
    objects,
    async put(key: string, body: string, options: { contentType: string }) {
      objects.set(key, {
        body,
        contentType: options.contentType,
      });

      return { pathname: key };
    },
    async read(key: string) {
      return objects.get(key) ?? null;
    },
  };
};

describe('BlobExportArtifactStore', () => {
  test('writes and reads stored manifests using blob keys', async () => {
    const client = createMemoryBlobClient();
    const store = new BlobExportArtifactStore({
      client,
      prefix: 'bulk-atr-test',
    });

    const key = await store.writeManifest('job-1', {
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

    expect(key).toBe('bulk-atr-test/manifests/job-1.json');
    expect(client.objects.get(key)?.contentType).toBe('application/json; charset=utf-8');

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

  test('writes ndjson payloads with trailing newlines and reads them back by key', async () => {
    const client = createMemoryBlobClient();
    const store = new BlobExportArtifactStore({
      client,
      prefix: 'bulk-atr-test',
    });

    const key = await store.writeNdjson('job-1', 'Patient-1.ndjson', [
      {
        resourceType: 'Patient',
        id: 'patient-0001',
      },
      {
        resourceType: 'Patient',
        id: 'patient-0002',
      },
    ]);

    expect(key).toBe('bulk-atr-test/files/job-1/Patient-1.ndjson');
    expect(client.objects.get(key)?.contentType).toBe('application/fhir+ndjson; charset=utf-8');

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

  test('throws when a requested blob key does not exist', async () => {
    const client = createMemoryBlobClient();
    const store = new BlobExportArtifactStore({
      client,
      prefix: 'bulk-atr-test',
    });

    await expect(store.readNdjson('bulk-atr-test/files/job-1/missing.ndjson')).rejects.toThrow(
      'Blob object was not found.',
    );
  });
});
