import type {
  SqlClient,
  SqlQueryable,
  SqlQueryResult,
  SqlRow,
} from "../lib/sql-client.ts";

type SupabaseRestOptions = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

const buildHeaders = (key: string) => ({
  Authorization: `Bearer ${key}`,
  apikey: key,
  "Content-Type": "application/json",
  Prefer: "return=representation",
});

export class SupabaseRestSqlClient implements SqlClient {
  private readonly restUrl: string;
  private readonly headers: Record<string, string>;

  constructor({ supabaseUrl, serviceRoleKey }: SupabaseRestOptions) {
    this.restUrl = `${supabaseUrl}/rest/v1`;
    this.headers = buildHeaders(serviceRoleKey);
  }

  private async restQuery<T extends SqlRow>(
    table: string,
    params: string,
    method = "GET",
    body?: unknown,
  ): Promise<SqlQueryResult<T>> {
    const url = `${this.restUrl}/${table}?${params}`;
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase REST ${method} ${table} failed (${response.status}): ${text}`);
    }
    const rows = await response.json() as T[];
    return { rows };
  }

  async query<T extends SqlRow>(
    text: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<T>> {
    // Route known SQL patterns to PostgREST calls.
    // This is a targeted adapter, not a general SQL→REST translator.
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    // SELECT from export_jobs
    if (normalized.includes("from export_jobs") && normalized.startsWith("select")) {
      const jobId = values?.[0] as string;
      return this.restQuery<T>("export_jobs", `job_id=eq.${jobId}&select=*`);
    }

    // SELECT from export_poll_windows
    if (normalized.includes("from export_poll_windows") && normalized.startsWith("select")) {
      const jobId = values?.[0] as string;
      const callerId = values?.[1] as string;
      return this.restQuery<T>(
        "export_poll_windows",
        `job_id=eq.${jobId}&caller_id=eq.${encodeURIComponent(callerId)}&select=*`,
      );
    }

    // INSERT into export_jobs
    if (normalized.includes("insert into export_jobs")) {
      return this.restQuery<T>("export_jobs", "", "POST", {
        job_id: values?.[0],
        group_id: values?.[1],
        status: "accepted",
        transaction_time: values?.[2],
        request_url: values?.[3],
        normalized_types: values?.[4],
        export_type: values?.[5],
        created_at: values?.[6],
        updated_at: values?.[6],
        expires_at: values?.[7],
        progress: "accepted",
        manifest_blob_key: null,
        files_json: [],
        errors_json: [],
      });
    }

    // INSERT into export_poll_windows (upsert)
    if (normalized.includes("insert into export_poll_windows")) {
      const headers = { ...this.headers, Prefer: "return=representation,resolution=merge-duplicates" };
      const url = `${this.restUrl}/export_poll_windows`;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          job_id: values?.[0],
          caller_id: values?.[1],
          last_polled_at: values?.[2],
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase REST upsert poll_windows failed (${response.status}): ${text}`);
      }
      return { rows: [] as unknown as T[] };
    }

    // UPDATE export_jobs (various patterns)
    if (normalized.includes("update export_jobs")) {
      return this.handleExportJobUpdate<T>(normalized, values);
    }

    // DELETE from export_poll_windows
    if (normalized.includes("delete from export_poll_windows")) {
      const jobId = values?.[0] as string;
      await fetch(`${this.restUrl}/export_poll_windows?job_id=eq.${jobId}`, {
        method: "DELETE",
        headers: this.headers,
      });
      return { rows: [] as unknown as T[] };
    }

    // DELETE from export_jobs
    if (normalized.includes("delete from export_jobs")) {
      const jobId = values?.[0] as string;
      await fetch(`${this.restUrl}/export_jobs?job_id=eq.${jobId}`, {
        method: "DELETE",
        headers: this.headers,
      });
      return { rows: [] as unknown as T[] };
    }

    // INSERT into export_manifests
    if (normalized.includes("insert into export_manifests")) {
      const headers = { ...this.headers, Prefer: "return=representation,resolution=merge-duplicates" };
      const url = `${this.restUrl}/export_manifests`;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          manifest_key: values?.[0],
          job_id: values?.[1],
          manifest_json: typeof values?.[2] === "string" ? JSON.parse(values[2] as string) : values?.[2],
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase REST insert manifest failed (${response.status}): ${text}`);
      }
      return { rows: [] as unknown as T[] };
    }

    // SELECT from export_manifests
    if (normalized.includes("from export_manifests")) {
      const key = values?.[0] as string;
      return this.restQuery<T>("export_manifests", `manifest_key=eq.${encodeURIComponent(key)}&select=*`);
    }

    // INSERT into export_files
    if (normalized.includes("insert into export_files")) {
      const headers = { ...this.headers, Prefer: "return=representation,resolution=merge-duplicates" };
      const url = `${this.restUrl}/export_files`;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          artifact_key: values?.[0],
          job_id: values?.[1],
          file_name: values?.[2],
          ndjson_payload: values?.[3],
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase REST insert file failed (${response.status}): ${text}`);
      }
      return { rows: [] as unknown as T[] };
    }

    // SELECT from export_files
    if (normalized.includes("from export_files")) {
      const key = values?.[0] as string;
      return this.restQuery<T>("export_files", `artifact_key=eq.${encodeURIComponent(key)}&select=*`);
    }

    // CREATE TABLE / schema operations — skip (handled by Supabase migrations)
    if (normalized.startsWith("create table") || normalized.startsWith("create index") || normalized.startsWith("alter table")) {
      return { rows: [] as unknown as T[] };
    }

    // SELECT 1 (health check)
    if (normalized === "select 1") {
      return { rows: [{ "?column?": 1 } as unknown as T] };
    }

    throw new Error(`SupabaseRestSqlClient: unsupported SQL pattern: ${text.slice(0, 100)}`);
  }

  private async handleExportJobUpdate<T extends SqlRow>(
    normalized: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<T>> {
    const jobId = values?.[0] as string;
    let filter = `job_id=eq.${jobId}`;
    let body: Record<string, unknown> = {};

    // claimJob: WHERE job_id = $1 AND (status = 'accepted' OR ...)
    if (normalized.includes("lease_owner") && normalized.includes("lease_token") && normalized.includes("status = 'accepted'")) {
      const now = values?.[1] as string;
      filter += `&or=(status.eq.accepted,and(status.eq.running,or(lease_expires_at.is.null,lease_expires_at.lte.${now})))`;
      body = {
        status: "running",
        progress: "writing ndjson files",
        updated_at: now,
        expires_at: values?.[2],
        lease_owner: values?.[3],
        lease_token: values?.[4],
        lease_expires_at: values?.[5],
      };
    }
    // markCompletedWithClaim: WHERE job_id = $1 AND lease_token = $2
    else if (normalized.includes("status = 'completed'") && normalized.includes("lease_token = $2")) {
      filter += `&lease_token=eq.${values?.[1]}`;
      body = {
        status: "completed",
        progress: "completed",
        manifest_blob_key: values?.[2],
        files_json: typeof values?.[3] === "string" ? JSON.parse(values[3] as string) : values?.[3],
        updated_at: values?.[4],
        expires_at: values?.[5],
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
      };
    }
    // markFailedWithClaim
    else if (normalized.includes("status = 'failed'") && normalized.includes("lease_token = $2")) {
      filter += `&lease_token=eq.${values?.[1]}`;
      body = {
        status: "failed",
        progress: "failed",
        errors_json: typeof values?.[2] === "string" ? JSON.parse(values[2] as string) : values?.[2],
        updated_at: values?.[3],
        expires_at: values?.[4],
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
      };
    }
    // markCompleted (no claim)
    else if (normalized.includes("status = 'completed'")) {
      body = {
        status: "completed",
        progress: "completed",
        manifest_blob_key: values?.[1],
        files_json: typeof values?.[2] === "string" ? JSON.parse(values[2] as string) : values?.[2],
        updated_at: values?.[3],
        expires_at: values?.[4],
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
      };
    }
    // markFailed (no claim)
    else if (normalized.includes("status = 'failed'")) {
      body = {
        status: "failed",
        progress: "failed",
        errors_json: typeof values?.[1] === "string" ? JSON.parse(values[1] as string) : values?.[1],
        updated_at: values?.[2],
        expires_at: values?.[3],
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
      };
    }
    // markRunning
    else if (normalized.includes("status = 'running'") && !normalized.includes("lease_owner")) {
      body = {
        status: "running",
        progress: values?.[1],
        updated_at: values?.[2],
        expires_at: values?.[3],
      };
    }
    // expireJob
    else if (normalized.includes("status = 'expired'")) {
      body = {
        status: "expired",
        updated_at: values?.[1],
        expires_at: values?.[1],
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
      };
    }

    const url = `${this.restUrl}/export_jobs?${filter}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase REST update export_jobs failed (${response.status}): ${text}`);
    }
    const rows = await response.json() as T[];
    return { rows };
  }

  async transaction<T>(
    callback: (transaction: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    // PostgREST doesn't support transactions. Execute sequentially.
    return callback(this);
  }

  async close(): Promise<void> {
    // No persistent connection to close.
  }
}
