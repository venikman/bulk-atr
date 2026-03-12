import { Hono } from "hono";
import type { AtrResolver } from "./lib/atr-resolver.ts";
import { type AppEnv, type AuthMode } from "./lib/auth.ts";
import type { ExportArtifactStore } from "./lib/export-artifact-store.ts";
import type { ExportJobRepository } from "./lib/export-job-repository.ts";
import { createBulkRoutes } from "./routes/bulk.ts";
import { createGroupRoutes } from "./routes/group.ts";
import { createMetadataRoutes } from "./routes/metadata.ts";
import { createResourceReadRoutes } from "./routes/resource-read.ts";

export type AppOptions = {
  authMode: AuthMode;
  resolver: AtrResolver;
  artifactStore: ExportArtifactStore;
  jobRepository: ExportJobRepository;
};

export const createApp = ({
  authMode,
  resolver,
  artifactStore,
  jobRepository,
}: AppOptions) => {
  const app = new Hono<AppEnv>();
  const fhir = new Hono<AppEnv>();

  app.get("/", (context) =>
    context.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bulk ATR Producer API</title>
  </head>
  <body>
    <main>
      <h1>Bulk ATR Producer API</h1>
      <p>ATR/FHIR API for Group discovery, linked reads, and asynchronous bulk export.</p>
      <ul>
        <li><a href="/fhir/metadata">CapabilityStatement</a></li>
        <li>
          <a href="/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&_summary=true">
            Group discovery
          </a>
        </li>
        <li><a href="/fhir/Group/group-2026-northwind-atr-001">Group read</a></li>
      </ul>
    </main>
  </body>
</html>`));

  fhir.route("/", createMetadataRoutes(authMode));
  fhir.route("/", createGroupRoutes({ resolver, authMode }));
  fhir.route(
    "/",
    createBulkRoutes({
      resolver,
      artifactStore,
      jobRepository,
      authMode,
    }),
  );
  fhir.route("/", createResourceReadRoutes({ resolver, authMode }));

  app.route("/fhir", fhir);

  return app;
};
