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

create table if not exists export_poll_windows (
  job_id uuid not null,
  caller_id text not null,
  last_polled_at timestamptz not null,
  primary key (job_id, caller_id)
);

create table if not exists export_manifests (
  manifest_key text primary key,
  job_id uuid not null,
  manifest_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists export_files (
  artifact_key text primary key,
  job_id uuid not null,
  file_name text not null,
  ndjson_payload text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, file_name)
);
