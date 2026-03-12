import { newDb } from "pg-mem";
import { PostgresExportArtifactStore } from "../../server/adapters/postgres-export-artifact-store.ts";
import { PostgresExportJobRepository } from "../../server/adapters/postgres-export-job-repository.ts";
import {
  type DataProfile,
  DEFAULT_DATA_PROFILE,
  loadSourceDocuments,
} from "../../server/bootstrap/data-profile.ts";
import { createApp } from "../../server/app.ts";
import { AtrResolver } from "../../server/lib/atr-resolver.ts";
import { createRawDomainStoreFromDocuments } from "../../server/lib/raw-domain-store.ts";
import { createTestSqlClient } from "./test-sql-client.ts";
import { applyPendingMigrations } from "../../server/lib/migrations.ts";

type CreateTestServerOptions = {
  authMode?: "none" | "smart-backend";
  dataProfile?: DataProfile;
};

export const createTestServer = async (
  options: CreateTestServerOptions | "none" | "smart-backend" = "none",
) => {
  const authMode = typeof options === "string" ? options : options.authMode ||
    "none";
  const dataProfile = typeof options === "string"
    ? DEFAULT_DATA_PROFILE
    : options.dataProfile || DEFAULT_DATA_PROFILE;
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql = createTestSqlClient(pool);
  await applyPendingMigrations(sql);

  const rawDomainStore = createRawDomainStoreFromDocuments(
    loadSourceDocuments(dataProfile),
  );
  const jobRepository = new PostgresExportJobRepository(sql);
  const artifactStore = new PostgresExportArtifactStore(sql);
  const app = createApp({
    authMode,
    resolver: new AtrResolver(rawDomainStore),
    artifactStore,
    jobRepository,
  });

  const request = (path: string, init?: RequestInit) => {
    const url = path.startsWith("http://") || path.startsWith("https://")
      ? path
      : `http://example.test${path}`;
    return app.request(new Request(url, init));
  };

  const cleanup = async () => {
    await sql.close();
  };

  return { app, request, cleanup, sql, jobRepository, artifactStore };
};
