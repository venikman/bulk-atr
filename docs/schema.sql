-- Complete database DDL for the Bulk ATR Producer.
-- All statements are idempotent (IF NOT EXISTS).

-- ============================================================
-- Export jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS export_jobs (
  job_id UUID PRIMARY KEY,
  group_id TEXT NOT NULL,
  status TEXT NOT NULL,
  transaction_time TIMESTAMPTZ NOT NULL,
  request_url TEXT NOT NULL,
  normalized_types TEXT[] NOT NULL,
  export_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  progress TEXT NOT NULL,
  manifest_blob_key TEXT,
  files_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS export_poll_windows (
  job_id UUID NOT NULL,
  caller_id TEXT NOT NULL,
  last_polled_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (job_id, caller_id)
);

-- ============================================================
-- Export artifacts (manifests + NDJSON files)
-- ============================================================
CREATE TABLE IF NOT EXISTS export_manifests (
  manifest_key TEXT PRIMARY KEY,
  job_id UUID NOT NULL,
  manifest_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS export_files (
  artifact_key TEXT PRIMARY KEY,
  job_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  ndjson_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, file_name)
);

-- ============================================================
-- FHIR resource storage
-- ============================================================
CREATE TABLE IF NOT EXISTS fhir_resources (
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_fhir_resources_type ON fhir_resources (resource_type);
CREATE INDEX IF NOT EXISTS idx_fhir_resources_group_name
  ON fhir_resources ((lower(resource_json->>'name')))
  WHERE resource_type = 'Group';
