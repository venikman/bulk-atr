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
      <h2>API Surface</h2>

      <section>
        <h3>Metadata</h3>
        <ul>
          <li><a href="/fhir/metadata">CapabilityStatement</a></li>
        </ul>
      </section>

      <section>
        <h3>Group</h3>
        <ul>
          <li>
            <a href="/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&_summary=true">
              Search by identifier
            </a>
          </li>
          <li>
            <a href="/fhir/Group?name=Northwind%20ACO%202026%20Member%20Attribution%20List&_summary=true">
              Search by name
            </a>
          </li>
          <li><a href="/fhir/Group/group-2026-northwind-atr-001">Read Group by id</a></li>
        </ul>
      </section>

      <section>
        <h3>Bulk Export</h3>
        <ul>
          <li>
            <a href="/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage">
              Kick off export
            </a>
          </li>
          <li><code>/fhir/bulk-status/{jobId}</code></li>
          <li><code>/fhir/bulk-files/{jobId}/{fileName}</code></li>
        </ul>
      </section>

      <section>
        <h3>Direct Reads</h3>
        <ul>
          <li><a href="/fhir/Patient/patient-0001">Patient</a></li>
          <li><a href="/fhir/Coverage/coverage-0001">Coverage</a></li>
          <li><a href="/fhir/RelatedPerson/relatedperson-0003">RelatedPerson</a></li>
          <li><a href="/fhir/Practitioner/practitioner-001">Practitioner</a></li>
          <li><a href="/fhir/PractitionerRole/practitionerrole-001">PractitionerRole</a></li>
          <li><a href="/fhir/Organization/organization-payer-001">Organization</a></li>
          <li><a href="/fhir/Location/location-001">Location</a></li>
        </ul>
      </section>

      <p>Some routes require a bearer token when the server runs in smart-backend mode.</p>
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
