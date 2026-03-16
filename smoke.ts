import { mkdir, writeFile } from "node:fs/promises";

/* ── Constants ───────────────────────────────────────────────────── */

export const PROD_BASE_URL =
  "https://bulk-atr.nedbailov375426.workers.dev/fhir";
export const LOCAL_BASE_URL = "http://127.0.0.1:3001/fhir";
export const DEFAULT_DOWNLOAD_DIR = ".artifacts/smoke";
export const DEFAULT_MAX_POLLS = 30;
export const DEFAULT_POLL_INTERVAL_MS = 1000;

const RESOURCE_TYPES = [
  "Patient",
  "Coverage",
  "RelatedPerson",
  "Practitioner",
  "PractitionerRole",
  "Organization",
  "Location",
  "Encounter",
  "Condition",
  "Procedure",
  "Observation",
  "MedicationRequest",
  "AllergyIntolerance",
] as const;

const NDJSON_DOWNLOADS = [
  ["Group", "groupFileUrl"],
  ["Patient", "patientFileUrl"],
  ["Coverage", "coverageFileUrl"],
  ["RelatedPerson", "relatedPersonFileUrl"],
  ["Practitioner", "practitionerFileUrl"],
  ["PractitionerRole", "practitionerRoleFileUrl"],
  ["Organization", "organizationFileUrl"],
  ["Location", "locationFileUrl"],
] as const;

/* ── Types ───────────────────────────────────────────────────────── */

type Workflow = "metadata" | "group" | "bulk" | "delete" | "full";
type Mode = "prod" | "local";

type RunnerOptions = {
  workflow: Workflow;
  mode: Mode;
  baseUrl: string;
  downloadDir: string;
  maxPolls: number;
  pollIntervalMs: number;
};

type WorkflowSummary = {
  bulkStatusUrl?: string;
  downloadedArtifacts: string[];
};

type ChildProcess = { kill(): void; exited: Promise<unknown> };

/* ── Helpers ─────────────────────────────────────────────────────── */

const join = (base: string, path: string) =>
  `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const enc = encodeURIComponent;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fail(msg: string): never {
  throw new Error(msg);
}

function ok(cond: boolean, msg: string): asserts cond {
  if (!cond) fail(msg);
}

/** Fetch a FHIR (or JSON) endpoint and return parsed body. */
async function fhirGet(
  fullUrl: string,
  accept = "application/fhir+json",
): Promise<{ status: number; headers: Headers; body: any }> {
  const res = await fetch(fullUrl, { headers: { Accept: accept } });
  const body = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body };
}

/** Fetch a path relative to base, assert 200, return the Bundle body. */
async function getBundle(base: string, path: string): Promise<any> {
  const { status, body } = await fhirGet(join(base, path));
  ok(status === 200, `GET ${path}: ${status}`);
  ok(body?.resourceType === "Bundle", `GET ${path}: not a Bundle`);
  ok(body?.type === "searchset", `GET ${path}: not a searchset`);
  return body;
}

/**
 * Check whether a resource field contains a coding with the given
 * system (optional) and code prefix.  Works for both single objects
 * (`code.coding`) and arrays (`type[].coding`, `category[].coding`).
 */
function hasCoding(
  r: any,
  field: string,
  system: string | undefined,
  codePrefix: string,
): boolean {
  const raw = r?.[field];
  if (!raw) return false;
  const items: any[] = Array.isArray(raw) ? raw : [raw];
  return items.some((item: any) =>
    item?.coding?.some(
      (c: any) =>
        (!system || c.system === system) && c.code?.startsWith(codePrefix),
    ),
  );
}

/* ── CLI ─────────────────────────────────────────────────────────── */

export function parseSmokeArgs(args: string[]): RunnerOptions {
  const opts: RunnerOptions = {
    workflow: "full",
    mode: "prod",
    baseUrl: "",
    downloadDir: DEFAULT_DOWNLOAD_DIR,
    maxPolls: DEFAULT_MAX_POLLS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };

  const queue = args.filter((t, i) => !(i === 0 && t === "--"));
  if (queue[0] && !queue[0].startsWith("--")) {
    const w = queue.shift()!;
    ok(
      ["metadata", "group", "bulk", "delete", "full"].includes(w),
      `Unknown workflow: ${w}`,
    );
    opts.workflow = w as Workflow;
  }

  while (queue.length) {
    const token = queue.shift()!;
    ok(token.startsWith("--"), `Unexpected argument: ${token}`);
    const [flag, inline] = token.split("=", 2);
    const val = inline ?? queue.shift();

    switch (flag) {
      case "--mode":
        ok(val === "prod" || val === "local", `Unknown mode: ${val}`);
        opts.mode = val;
        break;
      case "--base-url":
        ok(!!val, "Missing value for --base-url");
        opts.baseUrl = val!;
        break;
      case "--download-dir":
        ok(!!val, "Missing value for --download-dir");
        opts.downloadDir = val!;
        break;
      case "--max-polls": {
        const n = Number.parseInt(val ?? "", 10);
        ok(n > 0, `${flag} must be a positive integer`);
        opts.maxPolls = n;
        break;
      }
      case "--poll-interval-ms": {
        const n = Number.parseInt(val ?? "", 10);
        ok(n > 0, `${flag} must be a positive integer`);
        opts.pollIntervalMs = n;
        break;
      }
      default:
        fail(`Unknown flag: ${flag}`);
    }
  }

  if (!opts.baseUrl) {
    opts.baseUrl = opts.mode === "local" ? LOCAL_BASE_URL : PROD_BASE_URL;
  }
  return opts;
}

/* ── Server management ───────────────────────────────────────────── */

export function buildLocalServerCommand(): string[] {
  return ["bun", "run", "start"];
}

function startLocalServer(): ChildProcess {
  const [cmd, ...args] = buildLocalServerCommand();
  const proc = Bun.spawn([cmd, ...args], {
    env: { ...process.env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  return { kill: () => proc.kill(), exited: proc.exited };
}

async function waitForReady(url: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }
  fail(`Timed out waiting for server: ${url}`);
}

/* ── Workflow ────────────────────────────────────────────────────── */

export async function runSmokeWorkflow(
  opts: RunnerOptions,
): Promise<WorkflowSummary> {
  const state: Record<string, string> = {
    baseUrl: opts.baseUrl,
    groupIdentifier: "http://example.org/contracts|CTR-2026-NWACO-001",
    exportType: "hl7.fhir.us.davinci-atr",
    exportTypes:
      "Group,Patient,Coverage,RelatedPerson,Practitioner,PractitionerRole,Organization,Location",
    patientId: "patient-0001",
    practitionerId: "practitioner-001",
    practitionerRoleId: "practitionerrole-001",
    locationId: "location-001",
  };

  const base = state.baseUrl;
  const summary: WorkflowSummary = { downloadedArtifacts: [] };
  let child: ChildProcess | undefined;

  try {
    /* ── Local server ────────────────────────────────────────────── */
    if (opts.mode === "local") {
      const env = process.env;
      ok(
        !!(env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_URL),
        "Local mode requires DATABASE_URL, POSTGRES_URL, or SUPABASE_URL.",
      );
      child = startLocalServer();
      await waitForReady(join(base, "metadata"));
    }

    /* ── Metadata ────────────────────────────────────────────────── */
    if (opts.workflow === "metadata" || opts.workflow === "full") {
      console.log("Smoke step: Metadata");
      const { status } = await fhirGet(join(base, "metadata"));
      ok(status === 200, `Metadata: ${status}`);
    }
    if (opts.workflow === "metadata") return summary;

    /* ── Group discovery ─────────────────────────────────────────── */
    async function discoverGroup() {
      const b = await getBundle(
        base,
        `Group?identifier=${state.groupIdentifier}&_summary=true`,
      );
      state.groupId =
        b.entry?.[0]?.resource?.id ?? fail("Group discovery returned no id");
    }

    if (opts.workflow === "group" || opts.workflow === "full") {
      console.log("Smoke step: Group");
      await discoverGroup();
      const { status } = await fhirGet(join(base, `Group/${state.groupId}`));
      ok(status === 200, `Group read: ${status}`);
    }
    if (opts.workflow === "group") return summary;

    /* ── Bulk export ─────────────────────────────────────────────── */
    if (["bulk", "delete", "full"].includes(opts.workflow)) {
      if (!state.groupId) await discoverGroup();

      // Kick off
      console.log("Smoke step: Bulk Kickoff");
      const kickoff = await fhirGet(
        join(
          base,
          `Group/${state.groupId}/$davinci-data-export?exportType=${state.exportType}&_type=${state.exportTypes}`,
        ),
      );
      ok(kickoff.status === 202, `Kickoff: ${kickoff.status}`);
      state.bulkStatusUrl =
        kickoff.headers.get("content-location") ??
        fail("No content-location header");
      state.jobId = state.bulkStatusUrl.split("/").pop() ?? "";
      summary.bulkStatusUrl = state.bulkStatusUrl;
      console.log(`Bulk status URL: ${state.bulkStatusUrl}`);

      // Poll
      for (let i = 1; i <= opts.maxPolls; i++) {
        console.log("Smoke step: Bulk Poll");
        const poll = await fhirGet(state.bulkStatusUrl, "application/json");

        if (poll.status === 200) {
          for (const entry of poll.body?.output ?? []) {
            const dl = NDJSON_DOWNLOADS.find(([t]) => t === entry.type);
            if (dl) state[dl[1]] = entry.url;
          }
          break;
        }
        ok(poll.status === 202, `Poll: expected 200|202, got ${poll.status}`);
        ok(i < opts.maxPolls, `Export not complete after ${opts.maxPolls} polls`);
        await sleep(opts.pollIntervalMs);
      }

      // Download
      console.log("Smoke step: Bulk Downloads");
      await mkdir(opts.downloadDir, { recursive: true });
      for (const [type, key] of NDJSON_DOWNLOADS) {
        const fileUrl = state[key];
        if (!fileUrl) continue;
        const res = await fetch(fileUrl);
        ok(res.status === 200, `Download ${type}: ${res.status}`);
        const path = `${opts.downloadDir}/${type}.ndjson`;
        await writeFile(path, await res.text());
        summary.downloadedArtifacts.push(path);
      }
    }

    /* ── Full: extra verification ────────────────────────────────── */
    if (opts.workflow === "full") {
      // Direct reads — list each type, read first entry by ID
      console.log("Smoke step: Direct Reads");
      for (const rt of RESOURCE_TYPES) {
        const list = await getBundle(base, rt);
        const first = list.entry?.[0]?.resource;
        ok(first?.id, `No ${rt} resources found`);
        const { status, body, headers } = await fhirGet(
          join(base, `${rt}/${first.id}`),
        );
        ok(status === 200, `Read ${rt}/${first.id}: ${status}`);
        ok(body.resourceType === rt, `Read ${rt}/${first.id}: wrong type`);
        ok(body.id === first.id, `Read ${rt}/${first.id}: wrong id`);
        const ct = headers.get("content-type") ?? "";
        ok(
          ct.includes("application/fhir+json"),
          `Read ${rt}/${first.id}: content-type ${ct}`,
        );
      }

      // Resource lists + data integrity
      console.log("Smoke step: Resource Lists + Data Assertions");
      for (const rt of RESOURCE_TYPES) {
        const b = await getBundle(base, rt);
        ok((b.total ?? 0) >= 1, `List ${rt}: empty`);
        console.log(`  ${rt}: ${b.total}`);
      }

      const group = (
        await fhirGet(join(base, `Group/${state.groupId}`))
      ).body;
      ok(group.quantity >= 1, "Group: no members");
      ok(
        group.member?.length === group.quantity,
        `Group: quantity ${group.quantity} != member count ${group.member?.length}`,
      );

      const orgs = await getBundle(base, "Organization");
      const payers = (orgs.entry ?? []).filter((e: any) =>
        e.resource?.type?.some((t: any) =>
          t.coding?.some((c: any) => c.code === "payer"),
        ),
      );
      ok(payers.length >= 1, "No payer Organization found");

      // Reference integrity checks
      const refChecks: [string, string, (r: any) => boolean][] = [
        [
          "Coverage",
          "beneficiary → Patient",
          (r) =>
            r.beneficiary?.reference?.startsWith("Patient/") &&
            r.payor?.[0]?.reference?.startsWith("Organization/"),
        ],
        [
          "PractitionerRole",
          "practitioner + organization",
          (r) =>
            r.practitioner?.reference?.startsWith("Practitioner/") &&
            r.organization?.reference?.startsWith("Organization/"),
        ],
        [
          "RelatedPerson",
          "patient → Patient",
          (r) => r.patient?.reference?.startsWith("Patient/"),
        ],
        [
          "Location",
          "managingOrganization → Organization",
          (r) =>
            r.managingOrganization?.reference?.startsWith("Organization/"),
        ],
      ];
      for (const [rt, label, check] of refChecks) {
        const b = await getBundle(base, rt);
        for (const e of b.entry ?? []) {
          ok(check(e.resource), `${rt} ${e.resource.id}: bad ${label}`);
        }
        console.log(`  All ${b.total} ${rt}s pass ${label} check.`);
      }

      // Search parameters
      console.log("Smoke step: Search Parameters");
      const patRef = `Patient/${state.patientId}`;
      const pracRef = `Practitioner/${state.practitionerId}`;
      const prRef = `PractitionerRole/${state.practitionerRoleId}`;
      const locRef = `Location/${state.locationId}`;

      type Pred = (r: any) => boolean;
      const searches: [string, Pred?][] = [
        // Patient
        ["Patient?name=a"],
        [
          "Patient?birthdate=ge1960-01-01&birthdate=le2000-12-31",
          (r) => r.birthDate >= "1960-01-01" && r.birthDate <= "2000-12-31",
        ],
        ["Patient?gender=female", (r) => r.gender === "female"],
        [
          `Patient?general-practitioner=${prRef}`,
          (r) =>
            r.generalPractitioner?.some(
              (g: any) => g.reference === prRef,
            ),
        ],
        // Encounter
        [
          `Encounter?patient=${patRef}`,
          (r) => r.subject?.reference === patRef,
        ],
        ["Encounter?date=ge2025-01-01&date=le2025-12-31"],
        ["Encounter?status=finished", (r) => r.status === "finished"],
        [
          `Encounter?type=${enc("http://www.ama-assn.org/go/cpt|99213")}`,
          (r) =>
            hasCoding(r, "type", "http://www.ama-assn.org/go/cpt", "99213"),
        ],
        [
          `Encounter?practitioner=${pracRef}`,
          (r) =>
            r.participant?.some(
              (p: any) => p.individual?.reference === pracRef,
            ),
        ],
        [
          `Encounter?location=${locRef}`,
          (r) =>
            r.location?.some(
              (l: any) => l.location?.reference === locRef,
            ),
        ],
        [
          `Encounter?reason-code=${enc("http://hl7.org/fhir/sid/icd-10-cm|E11.9")}`,
          (r) =>
            hasCoding(
              r,
              "reasonCode",
              "http://hl7.org/fhir/sid/icd-10-cm",
              "E11.9",
            ),
        ],
        [
          `Encounter?practitioner=${pracRef}&date=ge2025-01-01&status=finished`,
          (r) =>
            r.status === "finished" &&
            r.participant?.some(
              (p: any) => p.individual?.reference === pracRef,
            ),
        ],
        // Condition
        [
          `Condition?patient=${patRef}`,
          (r) => r.subject?.reference === patRef,
        ],
        [
          `Condition?code=${enc("http://hl7.org/fhir/sid/icd-10-cm|E11")}`,
          (r) =>
            hasCoding(
              r,
              "code",
              "http://hl7.org/fhir/sid/icd-10-cm",
              "E11",
            ),
        ],
        [
          `Condition?clinical-status=active&code=${enc("http://hl7.org/fhir/sid/icd-10-cm|I10")}`,
          (r) =>
            r.clinicalStatus?.coding?.some(
              (c: any) => c.code === "active",
            ),
        ],
        [
          `Condition?category=encounter-diagnosis&patient=${patRef}`,
          (r) =>
            r.subject?.reference === patRef &&
            hasCoding(r, "category", undefined, "encounter-diagnosis"),
        ],
        // Procedure
        [
          `Procedure?patient=${patRef}`,
          (r) => r.subject?.reference === patRef,
        ],
        [
          `Procedure?code=${enc("http://www.ama-assn.org/go/cpt|99385")}`,
          (r) =>
            hasCoding(r, "code", "http://www.ama-assn.org/go/cpt", "99385"),
        ],
        // Observation
        [
          `Observation?patient=${patRef}&category=vital-signs`,
          (r) => hasCoding(r, "category", undefined, "vital-signs"),
        ],
        [
          `Observation?patient=${patRef}&category=laboratory`,
          (r) => hasCoding(r, "category", undefined, "laboratory"),
        ],
        [
          `Observation?code=${enc("http://loinc.org|4548-4")}&date=ge2025-01-01`,
          (r) => hasCoding(r, "code", "http://loinc.org", "4548-4"),
        ],
        // MedicationRequest
        [
          `MedicationRequest?patient=${patRef}&status=active`,
          (r) => r.subject?.reference === patRef && r.status === "active",
        ],
        [
          `MedicationRequest?code=${enc("http://www.nlm.nih.gov/research/umls/rxnorm|860975")}`,
          (r) =>
            hasCoding(
              r,
              "medicationCodeableConcept",
              "http://www.nlm.nih.gov/research/umls/rxnorm",
              "860975",
            ),
        ],
        // AllergyIntolerance
        [
          `AllergyIntolerance?patient=${patRef}`,
          (r) => r.patient?.reference === patRef,
        ],
      ];

      let checks = 0;
      for (const [path, pred] of searches) {
        const b = await getBundle(base, path);
        ok((b.total ?? 0) > 0, `Search ${path}: no results`);
        if (pred) {
          for (const e of b.entry ?? []) {
            ok(
              pred(e.resource),
              `Search ${path}: entry ${e.resource?.id} failed`,
            );
          }
        }
        checks++;
      }
      console.log(`  ${checks} search checks passed.`);

      // Not-found checks
      console.log("Smoke step: Not Found");
      for (const rt of RESOURCE_TYPES) {
        const { status, body } = await fhirGet(
          join(base, `${rt}/does-not-exist-999`),
        );
        ok(status === 404, `Not-found ${rt}: ${status}`);
        ok(
          body?.resourceType === "OperationOutcome",
          `Not-found ${rt}: not OperationOutcome`,
        );
      }
      const { status: fakeStatus } = await fhirGet(
        join(base, "FakeResource/fake-id"),
      );
      ok(fakeStatus === 404, `Unknown route: ${fakeStatus}`);
      const rootRes = await fetch(
        base.replace(/\/fhir$/, "/nonexistent"),
      );
      ok(rootRes.status === 404, `Non-FHIR path: ${rootRes.status}`);
      console.log(
        `  ${RESOURCE_TYPES.length + 2} not-found checks passed.`,
      );

      // Content-type spot checks
      console.log("Smoke step: Content-Type Checks");
      const metaCt =
        (await fhirGet(join(base, "metadata"))).headers.get("content-type") ??
        "";
      ok(
        metaCt.includes("application/fhir+json"),
        `Metadata content-type: ${metaCt}`,
      );
      const groupCt =
        (
          await fhirGet(
            join(
              base,
              `Group?identifier=${state.groupIdentifier}&_summary=true`,
            ),
          )
        ).headers.get("content-type") ?? "";
      ok(
        groupCt.includes("application/fhir+json"),
        `Group search content-type: ${groupCt}`,
      );
      const healthRes = await fetch(base.replace(/\/fhir$/, "/health"));
      ok(healthRes.status === 200, `Health: ${healthRes.status}`);
      const healthBody = (await healthRes.json()) as { status?: string };
      ok(healthBody.status === "ok", `Health status: ${healthBody.status}`);
      console.log("  Content-type and health checks passed.");
    }

    /* ── Delete ──────────────────────────────────────────────────── */
    if (opts.workflow === "delete" || opts.workflow === "full") {
      console.log("Smoke step: Delete");
      ok(!!state.bulkStatusUrl, "Delete requires a prior bulk export");

      const delRes = await fetch(state.bulkStatusUrl, { method: "DELETE" });
      ok(delRes.status === 202, `DELETE: ${delRes.status}`);
      console.log("DELETE returned 202 Accepted.");

      // Confirm the job is gone (retry once on 429)
      const confirm = await fetch(state.bulkStatusUrl, {
        headers: {
          Accept: "application/fhir+json",
          "x-forwarded-for": "198.51.100.99",
        },
      });

      if (confirm.status === 429) {
        console.log("GET after DELETE throttled, retrying...");
        const wait =
          (Number(confirm.headers.get("retry-after")) || 1) * 1000 + 100;
        await sleep(wait);
        const retry = await fetch(state.bulkStatusUrl, {
          headers: {
            Accept: "application/fhir+json",
            "x-forwarded-for": "198.51.100.99",
          },
        });
        ok(retry.status === 404, `DELETE confirm retry: ${retry.status}`);
        console.log("GET after DELETE confirmed 404 (after retry).");
      } else {
        ok(confirm.status === 404, `DELETE confirm: ${confirm.status}`);
        console.log("GET after DELETE confirmed 404.");
      }
    }

    return summary;
  } finally {
    if (child) {
      try {
        child.kill();
      } catch {}
      try {
        await child.exited;
      } catch {}
    }
  }
}

/* ── Main ────────────────────────────────────────────────────────── */

if (import.meta.main) {
  try {
    const opts = parseSmokeArgs(process.argv.slice(2));
    const summary = await runSmokeWorkflow(opts);

    if (summary.bulkStatusUrl) {
      console.log(`Final bulk status URL: ${summary.bulkStatusUrl}`);
    }
    if (summary.downloadedArtifacts.length > 0) {
      console.log("Downloaded artifacts:");
      for (const p of summary.downloadedArtifacts) console.log(p);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
