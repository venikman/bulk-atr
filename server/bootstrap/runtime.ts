import claimsAttributionSource from "../../data/sources/claims-attribution-service.json" with {
  type: "json",
};
import memberCoverageSource from "../../data/sources/member-coverage-service.json" with {
  type: "json",
};
import providerDirectorySource from "../../data/sources/provider-directory-service.json" with {
  type: "json",
};
import { PostgresExportArtifactStore } from "../adapters/postgres-export-artifact-store.ts";
import { PostgresExportJobRepository } from "../adapters/postgres-export-job-repository.ts";
import { createApp } from "../app.ts";
import { AtrResolver } from "../lib/atr-resolver.ts";
import type { AuthMode } from "../lib/auth.ts";
import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
} from "../lib/raw-domain-types.ts";
import { createRawDomainStoreFromDocuments } from "../lib/raw-domain-store.ts";
import type { SqlClient } from "../lib/sql-client.ts";

export type CreateRuntimeAppOptions = {
  authMode: AuthMode;
  sql: SqlClient;
};

export const createRuntimeApp = (
  { authMode, sql }: CreateRuntimeAppOptions,
) => {
  const rawDomainStore = createRawDomainStoreFromDocuments({
    memberCoverage: memberCoverageSource as MemberCoverageSourceDocument,
    providerDirectory:
      providerDirectorySource as ProviderDirectorySourceDocument,
    claimsAttribution:
      claimsAttributionSource as ClaimsAttributionSourceDocument,
  });
  const jobRepository = new PostgresExportJobRepository(sql);
  const artifactStore = new PostgresExportArtifactStore(sql);

  return createApp({
    authMode,
    resolver: new AtrResolver(rawDomainStore),
    artifactStore,
    jobRepository,
  });
};
