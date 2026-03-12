import { PostgresExportArtifactStore } from "../adapters/postgres-export-artifact-store.ts";
import { PostgresExportJobRepository } from "../adapters/postgres-export-job-repository.ts";
import { createApp } from "../app.ts";
import {
  type DataProfile,
  DEFAULT_DATA_PROFILE,
  loadSourceDocuments,
} from "./data-profile.ts";
import { AtrResolver } from "../lib/atr-resolver.ts";
import type { AuthMode } from "../lib/auth.ts";
import { createRawDomainStoreFromDocuments } from "../lib/raw-domain-store.ts";
import type { SqlClient } from "../lib/sql-client.ts";

export type CreateRuntimeAppOptions = {
  authMode: AuthMode;
  sql: SqlClient;
  dataProfile?: DataProfile;
};

export const createRuntimeApp = (
  {
    authMode,
    sql,
    dataProfile = DEFAULT_DATA_PROFILE,
  }: CreateRuntimeAppOptions,
) => {
  const rawDomainStore = createRawDomainStoreFromDocuments(
    loadSourceDocuments(dataProfile),
  );
  const jobRepository = new PostgresExportJobRepository(sql);
  const artifactStore = new PostgresExportArtifactStore(sql);

  return createApp({
    authMode,
    resolver: new AtrResolver(rawDomainStore),
    artifactStore,
    jobRepository,
  });
};
