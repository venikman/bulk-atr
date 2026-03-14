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
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700&display=swap"
    />
    <style>
      :root {
        color: #eaf0ff;
        background-color: #080c16;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Manrope", "Segoe UI", sans-serif;
        background: radial-gradient(circle at 20% 20%, #143a5c 0, #080c16 36%),
          radial-gradient(circle at 80% 10%, #1c2030 0, #080c16 40%),
          linear-gradient(140deg, rgba(26, 62, 120, 0.16), rgba(23, 118, 182, 0));
        color: #eaf0ff;
      }

      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }

      .hero {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 32px;
        box-shadow: 0 18px 50px rgba(4, 9, 20, 0.45);
        backdrop-filter: blur(6px);
      }

      .eyebrow {
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #7bd7ff;
        font-weight: 700;
        font-size: 12px;
        margin: 0 0 12px;
      }

      h1 {
        margin: 0 0 12px;
        font-size: clamp(28px, 4vw, 36px);
      }

      .lede {
        margin: 0 0 16px;
        color: #c7d8ff;
        line-height: 1.5;
        max-width: 760px;
      }

      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0 0;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: #c7d8ff;
        font-weight: 600;
      }

      .layout-grid {
        margin-top: 32px;
        display: grid;
        gap: 18px;
      }

      .panel {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 20px 22px;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
      }

      .panel h2 {
        margin: 0 0 8px;
        font-size: 18px;
      }

      .panel p {
        margin: 0 0 12px;
        color: #c7d8ff;
        line-height: 1.5;
      }

      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
        margin-top: 12px;
      }

      .card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        padding: 16px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        transition: transform 120ms ease, border-color 120ms ease;
      }

      .card:hover {
        transform: translateY(-2px);
        border-color: rgba(123, 215, 255, 0.65);
      }

      .card h3 {
        margin: 0 0 6px;
        font-size: 16px;
      }

      .card p {
        margin: 0 0 10px;
        color: #c7d8ff;
        line-height: 1.4;
      }

      .card a {
        color: #7bd7ff;
        font-weight: 700;
        text-decoration: none;
      }

      .card a:hover {
        text-decoration: underline;
      }

      .endpoint-list {
        margin: 10px 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 10px;
      }

      .endpoint {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .endpoint .label {
        font-weight: 700;
        color: #7bd7ff;
      }

      code {
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #f3f6ff;
        font-size: 13px;
      }

      a.inline {
        color: #7bd7ff;
        font-weight: 700;
      }

      footer {
        margin-top: 24px;
        color: #98a8c7;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Bulk ATR Producer</p>
        <h1>FHIR-powered attribution, ready for bulk export.</h1>
        <p class="lede">
          Explore the small set of applications exposed by this runtime:
          capability discovery, Group attribution lookup, Da Vinci ATR bulk export,
          and reference reads for the mapped member, coverage, and provider data.
        </p>
        <div class="badge-row">
          <span class="badge">FHIR R4 / Da Vinci ATR</span>
          <span class="badge">Async bulk export</span>
          <span class="badge">Deterministic seed data</span>
          <span class="badge">Auth: backend or SMART</span>
        </div>
      </section>

      <div class="layout-grid">
        <section class="panel">
          <h2>Exposed Applications</h2>
          <p>Each card opens a live route with the checked-in demo data.</p>
          <div class="card-grid">
            <article class="card">
              <h3>Capabilities</h3>
              <p>Inspect the CapabilityStatement advertised by this server.</p>
              <a href="/fhir/metadata">Open /fhir/metadata →</a>
            </article>
            <article class="card">
              <h3>Group discovery</h3>
              <p>Search the attribution Group by identifier or name, or read it directly.</p>
              <a href="/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&_summary=true">
                Try identifier search →
              </a>
            </article>
            <article class="card">
              <h3>Bulk export</h3>
              <p>Kick off a Da Vinci ATR export and poll for status and files.</p>
              <a href="/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage">
                Start an export →
              </a>
            </article>
            <article class="card">
              <h3>Reference reads</h3>
              <p>Browse sample member, coverage, and provider resources.</p>
              <a href="/fhir/Patient/patient-0001">View a Patient →</a>
            </article>
          </div>
        </section>

        <section class="panel">
          <h2>API Surface</h2>
          <ul class="endpoint-list">
            <li class="endpoint">
              <span class="label">Metadata</span>
              <a class="inline" href="/fhir/metadata">/fhir/metadata</a>
              <p>CapabilityStatement describing the deployed server.</p>
            </li>
            <li class="endpoint">
              <span class="label">Group lookup</span>
              <a class="inline" href="/fhir/Group?name=Northwind%20ACO%202026%20Member%20Attribution%20List&_summary=true">
                /fhir/Group?name=...
              </a>
              <a class="inline" href="/fhir/Group/group-2026-northwind-atr-001">
                /fhir/Group/group-2026-northwind-atr-001
              </a>
              <p>Search or read the attribution roster that backs exports.</p>
            </li>
            <li class="endpoint">
              <span class="label">Bulk export flow</span>
              <a
                class="inline"
                href="/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage"
              >
                /Group/.../$davinci-data-export
              </a>
              <code>/fhir/bulk-status/{jobId}</code>
              <code>/fhir/bulk-files/{jobId}/{fileName}</code>
              <p>Start a job, poll status, then download generated NDJSON files.</p>
            </li>
            <li class="endpoint">
              <span class="label">Direct reads</span>
              <div>
                <a class="inline" href="/fhir/Patient/patient-0001">Patient</a>
                ·
                <a class="inline" href="/fhir/Coverage/coverage-0001">Coverage</a>
                ·
                <a class="inline" href="/fhir/RelatedPerson/relatedperson-0003">RelatedPerson</a>
                ·
                <a class="inline" href="/fhir/Practitioner/practitioner-001">Practitioner</a>
                ·
                <a class="inline" href="/fhir/PractitionerRole/practitionerrole-001">PractitionerRole</a>
                ·
                <a class="inline" href="/fhir/Organization/organization-payer-001">Organization</a>
                ·
                <a class="inline" href="/fhir/Location/location-001">Location</a>
              </div>
              <p>Reference records tied to the current data profile.</p>
            </li>
          </ul>
        </section>

        <section class="panel">
          <h2>Runtime notes</h2>
          <p>
            Some routes require a bearer token when the server runs in SMART backend mode.
            Data comes from the checked-in <code>DATA_PROFILE</code> (default or large-200).
          </p>
          <p>
            Need to run locally? <code>deno task dev</code> starts the same surface at
            <code>http://localhost:3001/</code>.
          </p>
        </section>
      </div>

      <footer>Built for deterministic demo and smoke-testing of ATR exports.</footer>
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
