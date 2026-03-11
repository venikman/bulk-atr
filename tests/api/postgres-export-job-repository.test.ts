import { newDb } from 'pg-mem';
import {
  ensureExportJobSchema,
  PostgresExportJobRepository,
} from '../../server/adapters/postgres-export-job-repository.js';

const createRepository = async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await ensureExportJobSchema(pool);

  return {
    pool,
    repository: new PostgresExportJobRepository(pool),
  };
};

describe('PostgresExportJobRepository', () => {
  test('creates jobs, reads them back, and marks completion with stored artifact keys', async () => {
    const { repository } = await createRepository();

    await repository.createJob({
      jobId: '11111111-1111-4111-8111-111111111111',
      groupId: 'group-2026-northwind-atr-001',
      transactionTime: '2026-03-11T12:00:00.000Z',
      requestUrl:
        'http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage',
      normalizedTypes: ['Group', 'Patient', 'Coverage'],
      exportType: 'hl7.fhir.us.davinci-atr',
    });

    const completed = await repository.markCompleted(
      '11111111-1111-4111-8111-111111111111',
      'bulk-atr/manifests/11111111-1111-4111-8111-111111111111.json',
      [
        {
          type: 'Patient',
          fileName: 'Patient-1.ndjson',
          artifactKey: 'bulk-atr/files/11111111-1111-4111-8111-111111111111/Patient-1.ndjson',
        },
      ],
    );

    expect(completed?.status).toBe('completed');
    expect(completed?.manifestKey).toBe(
      'bulk-atr/manifests/11111111-1111-4111-8111-111111111111.json',
    );

    await expect(repository.getJob('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      jobId: '11111111-1111-4111-8111-111111111111',
      status: 'completed',
      files: [
        {
          type: 'Patient',
          fileName: 'Patient-1.ndjson',
          artifactKey: 'bulk-atr/files/11111111-1111-4111-8111-111111111111/Patient-1.ndjson',
        },
      ],
    });
  });

  test('enforces one-second poll throttling per caller and job', async () => {
    const { pool, repository } = await createRepository();

    await repository.createJob({
      jobId: '22222222-2222-4222-8222-222222222222',
      groupId: 'group-2026-northwind-atr-001',
      transactionTime: '2026-03-11T12:00:00.000Z',
      requestUrl:
        'http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage',
      normalizedTypes: ['Group', 'Patient', 'Coverage'],
      exportType: 'hl7.fhir.us.davinci-atr',
    });

    await expect(
      repository.canPoll('22222222-2222-4222-8222-222222222222', 'caller-a'),
    ).resolves.toBe(true);
    await expect(
      repository.canPoll('22222222-2222-4222-8222-222222222222', 'caller-a'),
    ).resolves.toBe(false);
    await expect(
      repository.canPoll('22222222-2222-4222-8222-222222222222', 'caller-b'),
    ).resolves.toBe(true);

    await pool.query(`
      update export_poll_windows
      set last_polled_at = now() - interval '2 seconds'
      where job_id = '22222222-2222-4222-8222-222222222222' and caller_id = 'caller-a'
    `);

    await expect(
      repository.canPoll('22222222-2222-4222-8222-222222222222', 'caller-a'),
    ).resolves.toBe(true);
  });

  test('treats expired jobs as not found', async () => {
    const { pool, repository } = await createRepository();

    await repository.createJob({
      jobId: '33333333-3333-4333-8333-333333333333',
      groupId: 'group-2026-northwind-atr-001',
      transactionTime: '2026-03-11T12:00:00.000Z',
      requestUrl:
        'http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage',
      normalizedTypes: ['Group', 'Patient', 'Coverage'],
      exportType: 'hl7.fhir.us.davinci-atr',
    });

    await pool.query(`
      update export_jobs
      set expires_at = now() - interval '1 second'
      where job_id = '33333333-3333-4333-8333-333333333333'
    `);

    await expect(repository.getJob('33333333-3333-4333-8333-333333333333')).resolves.toBeNull();
  });
});
