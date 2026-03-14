CREATE INDEX IF NOT EXISTS idx_export_jobs_status
  ON export_jobs (status) WHERE status IN ('accepted', 'running');

CREATE INDEX IF NOT EXISTS idx_export_files_job_id
  ON export_files (job_id);

CREATE INDEX IF NOT EXISTS idx_export_manifests_job_id
  ON export_manifests (job_id);
