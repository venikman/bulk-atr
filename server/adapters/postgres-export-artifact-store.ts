import type { ExportArtifactStore } from '../lib/export-artifact-store.js';
import type { FhirResource, StoredManifest } from '../lib/types.js';

type Queryable = {
  query<T extends { [column: string]: unknown } = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

type ManifestRow = {
  manifest_json: StoredManifest | string;
};

type FileRow = {
  ndjson_payload: string;
};

const buildManifestKey = (jobId: string) => `manifests/${jobId}.json`;
const buildArtifactKey = (jobId: string, fileName: string) => `files/${jobId}/${fileName}`;

const parseStoredJson = <T>(value: T | string) =>
  typeof value === 'string' ? (JSON.parse(value) as T) : value;

export const ensureExportArtifactSchema = async (queryable: Queryable) => {
  await queryable.query(`
    create table if not exists export_manifests (
      manifest_key text primary key,
      job_id uuid not null,
      manifest_json jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await queryable.query(`
    create table if not exists export_files (
      artifact_key text primary key,
      job_id uuid not null,
      file_name text not null,
      ndjson_payload text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (job_id, file_name)
    );
  `);
};

export class PostgresExportArtifactStore implements ExportArtifactStore {
  readonly queryable: Queryable;

  constructor(queryable: Queryable) {
    this.queryable = queryable;
  }

  async writeManifest(jobId: string, manifest: StoredManifest) {
    const manifestKey = buildManifestKey(jobId);

    await this.queryable.query(
      `
        insert into export_manifests (manifest_key, job_id, manifest_json)
        values ($1, $2, $3::jsonb)
        on conflict (manifest_key)
        do update set manifest_json = excluded.manifest_json, updated_at = now()
      `,
      [manifestKey, jobId, JSON.stringify(manifest)],
    );

    return manifestKey;
  }

  async writeNdjson(jobId: string, fileName: string, resources: FhirResource[]) {
    const artifactKey = buildArtifactKey(jobId, fileName);
    const payload = resources.map((resource) => JSON.stringify(resource)).join('\n');
    const ndjsonPayload = payload + (payload ? '\n' : '');

    await this.queryable.query(
      `
        insert into export_files (artifact_key, job_id, file_name, ndjson_payload)
        values ($1, $2, $3, $4)
        on conflict (artifact_key)
        do update set ndjson_payload = excluded.ndjson_payload, updated_at = now()
      `,
      [artifactKey, jobId, fileName, ndjsonPayload],
    );

    return artifactKey;
  }

  async readManifest(manifestKey: string) {
    const result = await this.queryable.query<ManifestRow>(
      'select manifest_json from export_manifests where manifest_key = $1',
      [manifestKey],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Postgres artifact was not found.');
    }

    return parseStoredJson<StoredManifest>(row.manifest_json);
  }

  async readNdjson(artifactKey: string) {
    const result = await this.queryable.query<FileRow>(
      'select ndjson_payload from export_files where artifact_key = $1',
      [artifactKey],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Postgres artifact was not found.');
    }

    return row.ndjson_payload;
  }
}
