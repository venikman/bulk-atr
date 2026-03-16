import { Hono } from "hono";
import { AtrResolver } from "./lib/atr-resolver.ts";
import type { ExportArtifactStore } from "./lib/export-artifact-store.ts";
import type { ExportJobRepository } from "./lib/export-job-repository.ts";
import type { FhirStore } from "./lib/fhir-store.ts";
import { fhirOperationOutcome } from "./lib/operation-outcome.ts";
import type { SqlClient } from "./lib/sql-client.ts";
import { createBulkRoutes } from "./routes/bulk.ts";
import { createGroupRoutes } from "./routes/group.ts";
import { createMetadataRoutes } from "./routes/metadata.ts";
import { createResourceReadRoutes } from "./routes/resource-read.ts";

export type AppOptions = {
  fhirStore: FhirStore;
  artifactStore: ExportArtifactStore;
  jobRepository: ExportJobRepository;
  sql?: SqlClient;
};

export const createApp = ({
  fhirStore,
  artifactStore,
  jobRepository,
  sql,
}: AppOptions) => {
  const resolver = new AtrResolver(fhirStore);
  const app = new Hono();
  const fhir = new Hono();

  app.use("*", async (context, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        ms,
      }),
    );
  });

  app.get("/health", async (context) => {
    if (sql) {
      try {
        await sql.query("SELECT 1");
      } catch {
        return context.json(
          { status: "error", detail: "database unreachable" },
          503,
        );
      }
    }
    return context.json({ status: "ok" }, 200);
  });

  fhir.route("/", createMetadataRoutes());
  fhir.route("/", createGroupRoutes({ resolver }));
  fhir.route(
    "/",
    createBulkRoutes({
      resolver,
      artifactStore,
      jobRepository,
    }),
  );
  fhir.route("/", createResourceReadRoutes({ resolver }));

  app.route("/fhir", fhir);

  app.notFound((context) => {
    const path = new URL(context.req.url).pathname;
    if (path === "/fhir" || path.startsWith("/fhir/")) {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        "The requested FHIR endpoint does not exist on this server.",
      );
    }
    return context.text("404 Not Found", 404);
  });

  return app;
};
