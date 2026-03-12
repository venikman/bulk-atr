import { newDb } from "pg-mem";
import { PostgresExportArtifactStore } from "../../server/adapters/postgres-export-artifact-store.ts";
import { PostgresExportJobRepository } from "../../server/adapters/postgres-export-job-repository.ts";
import { createApp } from "../../server/app.ts";
import { AtrResolver } from "../../server/lib/atr-resolver.ts";
import { createRawDomainStoreFromDocuments } from "../../server/lib/raw-domain-store.ts";
import claimsAttributionSource from "../../data/sources/claims-attribution-service.json" with {
  type: "json",
};
import memberCoverageSource from "../../data/sources/member-coverage-service.json" with {
  type: "json",
};
import providerDirectorySource from "../../data/sources/provider-directory-service.json" with {
  type: "json",
};
import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
} from "../../server/lib/raw-domain-types.ts";
import { createTestSqlClient } from "./test-sql-client.ts";
import { applyPendingMigrations } from "../../server/lib/migrations.ts";

export const createTestServer = async (
  authMode: "none" | "smart-backend" = "none",
) => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql = createTestSqlClient(pool);
  await applyPendingMigrations(sql);

  const rawDomainStore = createRawDomainStoreFromDocuments({
    memberCoverage: memberCoverageSource as MemberCoverageSourceDocument,
    providerDirectory:
      providerDirectorySource as ProviderDirectorySourceDocument,
    claimsAttribution:
      claimsAttributionSource as ClaimsAttributionSourceDocument,
  });
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
