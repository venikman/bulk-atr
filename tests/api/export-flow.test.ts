import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestServer } from './test-helpers.js';

const minimumTypes =
  'Group,Patient,Coverage,RelatedPerson,Practitioner,PractitionerRole,Organization,Location';

type ManifestPayload = {
  transactionTime: string;
  requiresAccessToken: boolean;
  output: Array<{
    type: string;
    url: string;
  }>;
};

type OutcomePayload = {
  resourceType: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCompletedManifest = async (
  server: Awaited<ReturnType<typeof createTestServer>>,
  contentLocation: string,
  init?: RequestInit,
  timeoutMs = 4000,
) => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | null = null;

  while (Date.now() < deadline) {
    const response = await server.request(contentLocation, init);
    lastStatus = response.status;
    if (response.status === 200) {
      return {
        response,
        manifest: (await response.json()) as ManifestPayload,
      };
    }
    await sleep(150);
  }

  throw new Error(
    `Bulk export did not complete within ${timeoutMs}ms for ${contentLocation}. Last status: ${
      lastStatus ?? 'none'
    }.`,
  );
};

const collectReferences = (value: unknown, refs: Set<string>) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferences(item, refs);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'reference' && typeof nested === 'string' && /^[A-Za-z]+\/[^/]+$/.test(nested)) {
      refs.add(nested);
      continue;
    }

    collectReferences(nested, refs);
  }
};

describe('bulk export flow', () => {
  test('kicks off export, completes asynchronously, and serves ndjson files', async () => {
    const server = await createTestServer();

    try {
      const kickoff = await server.request(
        `/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=${minimumTypes}`,
      );

      expect(kickoff.status).toBe(202);
      const contentLocation = kickoff.headers.get('content-location');
      expect(contentLocation).toContain('/fhir/bulk-status/');
      const jobId = contentLocation?.split('/').at(-1);
      expect(jobId).toBeTruthy();
      const jobPath = join(server.runtimeDir, 'jobs', `${jobId}.json`);
      const createdJob = JSON.parse(await readFile(jobPath, 'utf-8')) as {
        transactionTime: string;
      };

      const initialStatus = await server.request(contentLocation || '');
      expect(initialStatus.status).toBe(202);
      expect(initialStatus.headers.get('retry-after')).toBe('1');

      const { response: completedStatus, manifest } = await waitForCompletedManifest(
        server,
        contentLocation || '',
      );

      expect(completedStatus.status).toBe(200);
      expect(manifest.transactionTime).toBe(createdJob.transactionTime);
      expect(manifest.requiresAccessToken).toBe(false);
      expect(manifest.output).toHaveLength(8);

      const patientFile = manifest.output.find(
        (entry: { type: string }) => entry.type === 'Patient',
      );
      expect(patientFile).toBeDefined();
      if (!patientFile) {
        throw new Error('Expected Patient NDJSON file in manifest output.');
      }
      expect(patientFile.url).toContain('/fhir/bulk-files/');

      const downloadedResources: Array<
        Record<string, unknown> & { resourceType: string; id: string }
      > = [];
      for (const entry of manifest.output) {
        const fileResponse = await server.request(new URL(entry.url).pathname);
        const ndjson = await fileResponse.text();
        const lines = ndjson.trim().split('\n').filter(Boolean);

        expect(fileResponse.status).toBe(200);
        expect(fileResponse.headers.get('content-type')).toContain('application/fhir+ndjson');
        expect(lines.length).toBeGreaterThan(0);

        for (const line of lines) {
          downloadedResources.push(
            JSON.parse(line) as Record<string, unknown> & {
              resourceType: string;
              id: string;
            },
          );
        }
      }

      const index = new Set(
        downloadedResources.map((resource) => `${resource.resourceType}/${resource.id}`),
      );
      expect(index.has('Group/group-2026-northwind-atr-001')).toBe(true);
      expect(index.has('Patient/patient-0001')).toBe(true);
      expect(index.has('Coverage/coverage-0001')).toBe(true);

      for (const resource of downloadedResources) {
        const references = new Set<string>();
        collectReferences(resource, references);
        for (const reference of references) {
          expect(index.has(reference)).toBe(true);
        }
      }
    } finally {
      await server.cleanup();
    }
  });

  test('returns OperationOutcome errors for invalid export requests and polling', async () => {
    const server = await createTestServer();

    try {
      const badExportType = await server.request(
        '/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=wrong&_type=Group,Patient,Coverage',
      );
      expect(badExportType.status).toBe(400);
      expect(((await badExportType.json()) as OutcomePayload).resourceType).toBe(
        'OperationOutcome',
      );

      const missingMinimum = await server.request(
        '/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient',
      );
      expect(missingMinimum.status).toBe(400);

      const unsupported = await server.request(
        '/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage&_since=2026-01-01',
      );
      expect(unsupported.status).toBe(400);

      const kickoff = await server.request(
        '/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage',
      );
      const contentLocation = kickoff.headers.get('content-location') || '';

      const firstPoll = await server.request(contentLocation);
      expect(firstPoll.status).toBe(202);

      const secondPoll = await server.request(contentLocation);
      expect(secondPoll.status).toBe(429);
      expect(((await secondPoll.json()) as OutcomePayload).resourceType).toBe('OperationOutcome');

      const missingFile = await server.request('/fhir/bulk-files/not-a-job/Patient-1.ndjson');
      expect(missingFile.status).toBe(404);

      const missingStatus = await server.request('/fhir/bulk-status/not-a-job');
      expect(missingStatus.status).toBe(404);

      const aliasKickoff = await server.request(
        '/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&resourceTypes=Group,Patient,Coverage',
      );
      expect(aliasKickoff.status).toBe(202);
    } finally {
      await server.cleanup();
    }
  });

  test('traverses through PractitionerRole even when that type is not requested', async () => {
    const server = await createTestServer();

    try {
      const requestedTypes = 'Group,Patient,Coverage,Practitioner,Organization';
      const kickoff = await server.request(
        `/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=${requestedTypes}`,
      );
      expect(kickoff.status).toBe(202);

      const { response: status, manifest } = await waitForCompletedManifest(
        server,
        kickoff.headers.get('content-location') || '',
      );

      expect(status.status).toBe(200);
      expect(manifest.output.map((entry) => entry.type)).toEqual([
        'Group',
        'Patient',
        'Coverage',
        'Practitioner',
        'Organization',
      ]);

      const resourcesByType = new Map<string, Array<{ resourceType: string; id: string }>>();
      for (const entry of manifest.output) {
        const fileResponse = await server.request(new URL(entry.url).pathname);
        const ndjson = await fileResponse.text();
        const lines = ndjson.trim().split('\n').filter(Boolean);
        resourcesByType.set(
          entry.type,
          lines.map((line) => JSON.parse(line) as { resourceType: string; id: string }),
        );
      }

      expect(resourcesByType.get('Practitioner')?.length).toBeGreaterThan(0);
      expect(resourcesByType.get('Organization')?.length).toBeGreaterThan(0);
      expect(resourcesByType.has('PractitionerRole')).toBe(false);
    } finally {
      await server.cleanup();
    }
  });

  test('requires bearer auth in smart-backend mode and marks manifest accordingly', async () => {
    const server = await createTestServer('smart-backend');

    try {
      const unauthorizedKickoff = await server.request(
        '/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage',
      );
      expect(unauthorizedKickoff.status).toBe(401);

      const authorizedKickoff = await server.request(
        '/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage',
        {
          headers: {
            authorization: 'Bearer dev-token',
          },
        },
      );
      expect(authorizedKickoff.status).toBe(202);

      const contentLocation = authorizedKickoff.headers.get('content-location') || '';
      const { response: manifestResponse, manifest } = await waitForCompletedManifest(
        server,
        contentLocation,
        {
          headers: {
            authorization: 'Bearer dev-token',
          },
        },
      );

      expect(manifestResponse.status).toBe(200);
      expect(manifest.requiresAccessToken).toBe(true);
    } finally {
      await server.cleanup();
    }
  });
});
