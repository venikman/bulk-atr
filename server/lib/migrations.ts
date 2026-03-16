import { ensureExportArtifactSchema } from "../adapters/postgres-export-artifact-store.ts";
import { ensureExportJobSchema } from "../adapters/postgres-export-job-repository.ts";
import type { SqlClient, SqlQueryable } from "./sql-client.ts";

export const ensureFhirResourceSchema = async (queryable: SqlQueryable) => {
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS fhir_resources (
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (resource_type, resource_id)
    );
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS idx_fhir_resources_type
      ON fhir_resources (resource_type);
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS idx_fhir_resources_group_name
      ON fhir_resources ((lower(resource_json->>'name')))
      WHERE resource_type = 'Group';
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS idx_fhir_resources_subject_ref
      ON fhir_resources ((resource_json->'subject'->>'reference'))
      WHERE resource_type IN ('Encounter','Condition','Procedure','Observation','MedicationRequest');
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS idx_fhir_resources_allergy_patient_ref
      ON fhir_resources ((resource_json->'patient'->>'reference'))
      WHERE resource_type = 'AllergyIntolerance';
  `);
};

export const applyPendingMigrations = async (sql: SqlClient) => {
  await ensureExportJobSchema(sql);
  await ensureExportArtifactSchema(sql);
  await ensureFhirResourceSchema(sql);
};
