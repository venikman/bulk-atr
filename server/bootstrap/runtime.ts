import { PostgresExportArtifactStore } from "../adapters/postgres-export-artifact-store.ts";
import { PostgresExportJobRepository } from "../adapters/postgres-export-job-repository.ts";
import { PostgresFhirStore } from "../adapters/postgres-fhir-store.ts";
import { SupabaseRestFhirStore } from "../adapters/supabase-rest-fhir-store.ts";
import { createApp } from "../app.ts";
import type { FhirStore } from "../lib/fhir-store.ts";
import type { SqlClient } from "../lib/sql-client.ts";

export type CreateRuntimeAppOptions = {
  sql: SqlClient;
  supabaseUrl?: string;
  supabaseKey?: string;
};

export const createRuntimeApp = ({ sql, supabaseUrl, supabaseKey }: CreateRuntimeAppOptions) => {
  const fhirStore: FhirStore = supabaseUrl && supabaseKey
    ? new SupabaseRestFhirStore(supabaseUrl, supabaseKey)
    : new PostgresFhirStore(sql);

  const jobRepository = new PostgresExportJobRepository(sql);
  const artifactStore = new PostgresExportArtifactStore(sql);

  return createApp({
    fhirStore,
    artifactStore,
    jobRepository,
    sql,
  });
};
