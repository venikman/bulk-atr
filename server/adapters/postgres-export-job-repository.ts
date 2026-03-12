import type {
  ClaimedExportJob,
  CreateExportJobInput,
  ExportJobRepository,
} from "../lib/export-job-repository.ts";
import type { SqlClient, SqlQueryable, SqlRow } from "../lib/sql-client.ts";
import type { ExportFileRecord, ExportJobRecord } from "../lib/types.ts";

const STATUS_POLL_WINDOW_MS = 1000;
const COMPLETED_JOB_TTL_MS = 60 * 60 * 1000;
const ACTIVE_JOB_TTL_MS = 15 * 60 * 1000;
const JOB_LEASE_MS = 30 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ExportJobRow = SqlRow & {
  job_id: string;
  group_id: string;
  status: ExportJobRecord["status"];
  transaction_time: string;
  request_url: string;
  normalized_types: string[];
  export_type: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  progress: string;
  manifest_blob_key: string | null;
  files_json: ExportFileRecord[] | string;
  errors_json: string[] | string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
};

const addMs = (iso: string, ms: number) =>
  new Date(new Date(iso).getTime() + ms).toISOString();
const isUuid = (value: string) => UUID_PATTERN.test(value);

const parseJsonArray = <T>(value: T[] | string | null | undefined) => {
  if (!value) {
    return [] as T[];
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T[];
  }

  return value;
};

const mapRowToJob = (row: ExportJobRow): ExportJobRecord => ({
  jobId: row.job_id,
  groupId: row.group_id,
  status: row.status,
  transactionTime: row.transaction_time,
  requestUrl: row.request_url,
  normalizedTypes: row.normalized_types as ExportJobRecord["normalizedTypes"],
  exportType: row.export_type,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at,
  progress: row.progress,
  manifestKey: row.manifest_blob_key,
  files: parseJsonArray<ExportFileRecord>(row.files_json),
  error: parseJsonArray<string>(row.errors_json),
});

export const ensureExportJobSchema = async (queryable: SqlQueryable) => {
  await queryable.query(`
    create table if not exists export_jobs (
      job_id uuid primary key,
      group_id text not null,
      status text not null,
      transaction_time timestamptz not null,
      request_url text not null,
      normalized_types text[] not null,
      export_type text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      expires_at timestamptz not null,
      progress text not null,
      manifest_blob_key text,
      files_json jsonb not null default '[]'::jsonb,
      errors_json jsonb not null default '[]'::jsonb,
      lease_owner text,
      lease_token text,
      lease_expires_at timestamptz
    );
  `);

  await queryable.query(`
    alter table export_jobs
    add column if not exists lease_owner text;
  `);
  await queryable.query(`
    alter table export_jobs
    add column if not exists lease_token text;
  `);
  await queryable.query(`
    alter table export_jobs
    add column if not exists lease_expires_at timestamptz;
  `);

  await queryable.query(`
    create table if not exists export_poll_windows (
      job_id uuid not null,
      caller_id text not null,
      last_polled_at timestamptz not null,
      primary key (job_id, caller_id)
    );
  `);
};

export class PostgresExportJobRepository implements ExportJobRepository {
  readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  private async deleteExpired(jobId: string) {
    await this.sql.query("delete from export_poll_windows where job_id = $1", [
      jobId,
    ]);
    await this.sql.query("delete from export_jobs where job_id = $1", [jobId]);
  }

  async createJob(input: CreateExportJobInput) {
    const now = new Date().toISOString();
    const expiresAt = addMs(now, ACTIVE_JOB_TTL_MS);
    const result = await this.sql.query<ExportJobRow>(
      `
        insert into export_jobs (
          job_id,
          group_id,
          status,
          transaction_time,
          request_url,
          normalized_types,
          export_type,
          created_at,
          updated_at,
          expires_at,
          progress,
          manifest_blob_key,
          files_json,
          errors_json
        )
        values ($1, $2, 'accepted', $3, $4, $5, $6, $7, $7, $8, 'accepted', null, '[]'::jsonb, '[]'::jsonb)
        returning *
      `,
      [
        input.jobId,
        input.groupId,
        input.transactionTime,
        input.requestUrl,
        input.normalizedTypes,
        input.exportType,
        now,
        expiresAt,
      ],
    );

    return mapRowToJob(result.rows[0] as ExportJobRow);
  }

  async getJob(jobId: string) {
    if (!isUuid(jobId)) {
      return null;
    }

    const result = await this.sql.query<ExportJobRow>(
      "select * from export_jobs where job_id = $1",
      [jobId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.deleteExpired(jobId);
      return null;
    }

    return mapRowToJob(row);
  }

  async markRunning(jobId: string, progress: string) {
    const now = new Date().toISOString();
    const result = await this.sql.query<ExportJobRow>(
      `
        update export_jobs
        set status = 'running',
            progress = $2,
            updated_at = $3,
            expires_at = $4
        where job_id = $1
        returning *
      `,
      [jobId, progress, now, addMs(now, ACTIVE_JOB_TTL_MS)],
    );

    return result.rows[0] ? mapRowToJob(result.rows[0]) : null;
  }

  async claimJob(
    jobId: string,
    workerId: string,
  ): Promise<ClaimedExportJob | null> {
    if (!isUuid(jobId)) {
      return null;
    }

    const now = new Date().toISOString();
    const leaseToken = crypto.randomUUID();
    const result = await this.sql.query<ExportJobRow>(
      `
        update export_jobs
        set status = 'running',
            progress = 'writing ndjson files',
            updated_at = $2,
            expires_at = $3,
            lease_owner = $4,
            lease_token = $5,
            lease_expires_at = $6
        where job_id = $1
          and (
            status = 'accepted'
            or (status = 'running' and (lease_expires_at is null or lease_expires_at <= $2))
          )
        returning *
      `,
      [
        jobId,
        now,
        addMs(now, ACTIVE_JOB_TTL_MS),
        workerId,
        leaseToken,
        addMs(now, JOB_LEASE_MS),
      ],
    );
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      claimToken: leaseToken,
      job: mapRowToJob(row),
    };
  }

  async markCompleted(
    jobId: string,
    manifestKey: string,
    files: ExportFileRecord[],
  ) {
    const now = new Date().toISOString();
    const result = await this.sql.query<ExportJobRow>(
      `
        update export_jobs
        set status = 'completed',
            progress = 'completed',
            manifest_blob_key = $2,
            files_json = $3::jsonb,
            updated_at = $4,
            expires_at = $5,
            lease_owner = null,
            lease_token = null,
            lease_expires_at = null
        where job_id = $1
        returning *
      `,
      [
        jobId,
        manifestKey,
        JSON.stringify(files),
        now,
        addMs(now, COMPLETED_JOB_TTL_MS),
      ],
    );

    return result.rows[0] ? mapRowToJob(result.rows[0]) : null;
  }

  async markCompletedWithClaim(
    jobId: string,
    claimToken: string,
    manifestKey: string,
    files: ExportFileRecord[],
  ) {
    const now = new Date().toISOString();
    const result = await this.sql.query<ExportJobRow>(
      `
        update export_jobs
        set status = 'completed',
            progress = 'completed',
            manifest_blob_key = $3,
            files_json = $4::jsonb,
            updated_at = $5,
            expires_at = $6,
            lease_owner = null,
            lease_token = null,
            lease_expires_at = null
        where job_id = $1 and lease_token = $2
        returning *
      `,
      [
        jobId,
        claimToken,
        manifestKey,
        JSON.stringify(files),
        now,
        addMs(now, COMPLETED_JOB_TTL_MS),
      ],
    );

    return result.rows[0] ? mapRowToJob(result.rows[0]) : null;
  }

  async markFailed(jobId: string, diagnostics: string[]) {
    const now = new Date().toISOString();
    const result = await this.sql.query<ExportJobRow>(
      `
        update export_jobs
        set status = 'failed',
            progress = 'failed',
            errors_json = $2::jsonb,
            updated_at = $3,
            expires_at = $4,
            lease_owner = null,
            lease_token = null,
            lease_expires_at = null
        where job_id = $1
        returning *
      `,
      [
        jobId,
        JSON.stringify(diagnostics),
        now,
        addMs(now, COMPLETED_JOB_TTL_MS),
      ],
    );

    return result.rows[0] ? mapRowToJob(result.rows[0]) : null;
  }

  async markFailedWithClaim(
    jobId: string,
    claimToken: string,
    diagnostics: string[],
  ) {
    const now = new Date().toISOString();
    const result = await this.sql.query<ExportJobRow>(
      `
        update export_jobs
        set status = 'failed',
            progress = 'failed',
            errors_json = $3::jsonb,
            updated_at = $4,
            expires_at = $5,
            lease_owner = null,
            lease_token = null,
            lease_expires_at = null
        where job_id = $1 and lease_token = $2
        returning *
      `,
      [
        jobId,
        claimToken,
        JSON.stringify(diagnostics),
        now,
        addMs(now, COMPLETED_JOB_TTL_MS),
      ],
    );

    return result.rows[0] ? mapRowToJob(result.rows[0]) : null;
  }

  canPoll(jobId: string, callerId: string) {
    return this.sql.transaction(async (transaction) => {
      const current = await transaction.query<{ last_polled_at: string }>(
        `
          select last_polled_at
          from export_poll_windows
          where job_id = $1 and caller_id = $2
          for update
        `,
        [jobId, callerId],
      );

      const now = new Date();
      const lastPoll = current.rows[0]?.last_polled_at;
      if (
        lastPoll &&
        now.getTime() - new Date(lastPoll).getTime() < STATUS_POLL_WINDOW_MS
      ) {
        return false;
      }

      await transaction.query(
        `
          insert into export_poll_windows (job_id, caller_id, last_polled_at)
          values ($1, $2, $3)
          on conflict (job_id, caller_id)
          do update set last_polled_at = excluded.last_polled_at
        `,
        [jobId, callerId, now.toISOString()],
      );

      return true;
    });
  }
}
