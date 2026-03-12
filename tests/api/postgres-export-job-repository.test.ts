import { describe, expect, it } from "../test-deps.ts";
import { newDb } from "pg-mem";
import { PostgresExportJobRepository } from "../../server/adapters/postgres-export-job-repository.ts";
import { applyPendingMigrations } from "../../server/lib/migrations.ts";
import { createTestSqlClient } from "./test-sql-client.ts";

const createRepository = async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql = createTestSqlClient(pool);
  await applyPendingMigrations(sql);

  return {
    sql,
    repository: new PostgresExportJobRepository(sql),
  };
};

describe("PostgresExportJobRepository", () => {
  it("claims accepted jobs once and allows reclaim after lease expiry", async () => {
    const { sql, repository } = await createRepository();

    await repository.createJob({
      jobId: "00000000-0000-4000-8000-000000000001",
      groupId: "group-2026-northwind-atr-001",
      transactionTime: "2026-03-11T12:00:00.000Z",
      requestUrl:
        "http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage",
      normalizedTypes: ["Group", "Patient", "Coverage"],
      exportType: "hl7.fhir.us.davinci-atr",
    });

    const firstClaim = await (repository as PostgresExportJobRepository & {
      claimJob(jobId: string, workerId: string): Promise<
        {
          claimToken: string;
          job: { status: string };
        } | null
      >;
    }).claimJob("00000000-0000-4000-8000-000000000001", "worker-a");

    expect(firstClaim?.job.status).toBe("running");
    expect(typeof firstClaim?.claimToken).toBe("string");

    await expect(
      (repository as PostgresExportJobRepository & {
        claimJob(jobId: string, workerId: string): Promise<unknown>;
      }).claimJob("00000000-0000-4000-8000-000000000001", "worker-b"),
    ).resolves.toBeNull();

    await sql.query(`
      update export_jobs
      set lease_expires_at = now() - interval '1 second'
      where job_id = '00000000-0000-4000-8000-000000000001'
    `);

    const reclaimed = await (repository as PostgresExportJobRepository & {
      claimJob(jobId: string, workerId: string): Promise<
        {
          claimToken: string;
          job: { status: string };
        } | null
      >;
    }).claimJob("00000000-0000-4000-8000-000000000001", "worker-c");

    expect(reclaimed?.job.status).toBe("running");
    expect(reclaimed?.claimToken).not.toBe(firstClaim?.claimToken);
  });

  it("creates jobs, reads them back, and marks completion with stored artifact keys", async () => {
    const { repository } = await createRepository();

    await repository.createJob({
      jobId: "11111111-1111-4111-8111-111111111111",
      groupId: "group-2026-northwind-atr-001",
      transactionTime: "2026-03-11T12:00:00.000Z",
      requestUrl:
        "http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage",
      normalizedTypes: ["Group", "Patient", "Coverage"],
      exportType: "hl7.fhir.us.davinci-atr",
    });

    const completed = await repository.markCompleted(
      "11111111-1111-4111-8111-111111111111",
      "bulk-atr/manifests/11111111-1111-4111-8111-111111111111.json",
      [
        {
          type: "Patient",
          fileName: "Patient-1.ndjson",
          artifactKey:
            "bulk-atr/files/11111111-1111-4111-8111-111111111111/Patient-1.ndjson",
        },
      ],
    );

    expect(completed?.status).toBe("completed");
    expect(completed?.manifestKey).toBe(
      "bulk-atr/manifests/11111111-1111-4111-8111-111111111111.json",
    );

    await expect(repository.getJob("11111111-1111-4111-8111-111111111111"))
      .resolves.toMatchObject({
        jobId: "11111111-1111-4111-8111-111111111111",
        status: "completed",
        files: [
          {
            type: "Patient",
            fileName: "Patient-1.ndjson",
            artifactKey:
              "bulk-atr/files/11111111-1111-4111-8111-111111111111/Patient-1.ndjson",
          },
        ],
      });
  });

  it("enforces one-second poll throttling per caller and job", async () => {
    const { sql, repository } = await createRepository();

    await repository.createJob({
      jobId: "22222222-2222-4222-8222-222222222222",
      groupId: "group-2026-northwind-atr-001",
      transactionTime: "2026-03-11T12:00:00.000Z",
      requestUrl:
        "http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage",
      normalizedTypes: ["Group", "Patient", "Coverage"],
      exportType: "hl7.fhir.us.davinci-atr",
    });

    await expect(
      repository.canPoll("22222222-2222-4222-8222-222222222222", "caller-a"),
    ).resolves.toBe(true);
    await expect(
      repository.canPoll("22222222-2222-4222-8222-222222222222", "caller-a"),
    ).resolves.toBe(false);
    await expect(
      repository.canPoll("22222222-2222-4222-8222-222222222222", "caller-b"),
    ).resolves.toBe(true);

    await sql.query(`
      update export_poll_windows
      set last_polled_at = now() - interval '2 seconds'
      where job_id = '22222222-2222-4222-8222-222222222222' and caller_id = 'caller-a'
    `);

    await expect(
      repository.canPoll("22222222-2222-4222-8222-222222222222", "caller-a"),
    ).resolves.toBe(true);
  });

  it("treats expired jobs as not found", async () => {
    const { sql, repository } = await createRepository();

    await repository.createJob({
      jobId: "33333333-3333-4333-8333-333333333333",
      groupId: "group-2026-northwind-atr-001",
      transactionTime: "2026-03-11T12:00:00.000Z",
      requestUrl:
        "http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage",
      normalizedTypes: ["Group", "Patient", "Coverage"],
      exportType: "hl7.fhir.us.davinci-atr",
    });

    await sql.query(`
      update export_jobs
      set expires_at = now() - interval '1 second'
      where job_id = '33333333-3333-4333-8333-333333333333'
    `);

    await expect(repository.getJob("33333333-3333-4333-8333-333333333333"))
      .resolves.toBeNull();
  });

  it("treats invalid job ids as not found instead of surfacing database errors", async () => {
    const { repository } = await createRepository();

    await expect(repository.getJob("not-a-job")).resolves.toBeNull();
  });

  it("only the active claim token can complete a running job", async () => {
    const { sql, repository } = await createRepository();

    await repository.createJob({
      jobId: "00000000-0000-4000-8000-000000000002",
      groupId: "group-2026-northwind-atr-001",
      transactionTime: "2026-03-11T12:00:00.000Z",
      requestUrl:
        "http://example.test/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage",
      normalizedTypes: ["Group", "Patient", "Coverage"],
      exportType: "hl7.fhir.us.davinci-atr",
    });

    const firstClaim = await (repository as PostgresExportJobRepository & {
      claimJob(
        jobId: string,
        workerId: string,
      ): Promise<{ claimToken: string } | null>;
    }).claimJob("00000000-0000-4000-8000-000000000002", "worker-a");

    await sql.query(`
      update export_jobs
      set lease_expires_at = now() - interval '1 second'
      where job_id = '00000000-0000-4000-8000-000000000002'
    `);

    const secondClaim = await (repository as PostgresExportJobRepository & {
      claimJob(
        jobId: string,
        workerId: string,
      ): Promise<{ claimToken: string } | null>;
      markCompletedWithClaim(
        jobId: string,
        claimToken: string,
        manifestKey: string,
        files: Array<
          { type: "Patient"; fileName: string; artifactKey: string }
        >,
      ): Promise<{ status: string } | null>;
    }).claimJob("00000000-0000-4000-8000-000000000002", "worker-b");

    await expect(
      (repository as PostgresExportJobRepository & {
        markCompletedWithClaim(
          jobId: string,
          claimToken: string,
          manifestKey: string,
          files: Array<
            { type: "Patient"; fileName: string; artifactKey: string }
          >,
        ): Promise<{ status: string } | null>;
      }).markCompletedWithClaim(
        "00000000-0000-4000-8000-000000000002",
        firstClaim?.claimToken || "missing",
        "manifests/00000000-0000-4000-8000-000000000002.json",
        [
          {
            type: "Patient",
            fileName: "Patient-1.ndjson",
            artifactKey:
              "files/00000000-0000-4000-8000-000000000002/Patient-1.ndjson",
          },
        ],
      ),
    ).resolves.toBeNull();

    await expect(
      (repository as PostgresExportJobRepository & {
        markCompletedWithClaim(
          jobId: string,
          claimToken: string,
          manifestKey: string,
          files: Array<
            { type: "Patient"; fileName: string; artifactKey: string }
          >,
        ): Promise<{ status: string } | null>;
      }).markCompletedWithClaim(
        "00000000-0000-4000-8000-000000000002",
        secondClaim?.claimToken || "missing",
        "manifests/00000000-0000-4000-8000-000000000002.json",
        [
          {
            type: "Patient",
            fileName: "Patient-1.ndjson",
            artifactKey:
              "files/00000000-0000-4000-8000-000000000002/Patient-1.ndjson",
          },
        ],
      ),
    ).resolves.toMatchObject({ status: "completed" });
  });
});
