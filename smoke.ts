import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// TODO: update once production host is decided
export const PROD_BASE_URL = "https://bulk-atr.nedbailov375426.workers.dev/fhir";
export const LOCAL_BASE_URL = "http://127.0.0.1:3001/fhir";
export const DEFAULT_DOWNLOAD_DIR = ".artifacts/smoke";
export const DEFAULT_MAX_POLLS = 30;
export const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_ENVIRONMENT_VALUES: EnvironmentValues = {
  baseUrl: PROD_BASE_URL,
  groupIdentifier: "http://example.org/contracts|CTR-2026-NWACO-001",
  groupName: "",
  groupId: "",
  exportType: "hl7.fhir.us.davinci-atr",
  exportTypes:
    "Group,Patient,Coverage,RelatedPerson,Practitioner,PractitionerRole,Organization,Location",
  jobId: "",
  bulkStatusUrl: "",
  groupFileUrl: "",
  patientFileUrl: "",
  coverageFileUrl: "",
  relatedPersonFileUrl: "",
  practitionerFileUrl: "",
  practitionerRoleFileUrl: "",
  organizationFileUrl: "",
  locationFileUrl: "",
  patientId: "patient-0001",
  coverageId: "coverage-0001",
  practitionerId: "practitioner-001",
  practitionerRoleId: "practitionerrole-001",
  organizationId: "org-payer-001",
  locationId: "location-001",
  relatedPersonId: "relatedperson-0003",
  encounterId: "encounter-0001",
  conditionId: "condition-0001",
};

type Workflow = "metadata" | "group" | "bulk" | "delete" | "full";
type Mode = "prod" | "local";
type PathLike = string | URL;

type PostmanEnvironmentValue = {
  key: string;
  value?: string;
  type?: string;
  enabled?: boolean;
};

type PostmanEnvironmentDocument = {
  name?: string;
  values?: PostmanEnvironmentValue[];
};

type RunnerOptions = {
  workflow: Workflow;
  mode: Mode;
  baseUrl: string;
  downloadDir: string;
  maxPolls: number;
  pollIntervalMs: number;
};

type CreateWorkingEnvironmentArgs = {
  outputDirectory: PathLike;
  baseUrl: string;
};

type WorkflowSummary = {
  bulkStatusUrl?: string;
  downloadedArtifacts: string[];
};

type ChildProcess = {
  kill(): void;
  exited: Promise<unknown>;
};

type WorkflowDependencies = {
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  sleepImpl?: (ms: number) => Promise<void>;
  startLocalServer?: () => ChildProcess;
};

type EnvironmentValues = Record<string, string>;

const RESOURCE_DOWNLOADS = [
  { envKey: "groupFileUrl", fileName: "Group.ndjson" },
  { envKey: "patientFileUrl", fileName: "Patient.ndjson" },
  { envKey: "coverageFileUrl", fileName: "Coverage.ndjson" },
  { envKey: "relatedPersonFileUrl", fileName: "RelatedPerson.ndjson" },
  { envKey: "practitionerFileUrl", fileName: "Practitioner.ndjson" },
  { envKey: "practitionerRoleFileUrl", fileName: "PractitionerRole.ndjson" },
  { envKey: "organizationFileUrl", fileName: "Organization.ndjson" },
  { envKey: "locationFileUrl", fileName: "Location.ndjson" },
] as const;

export function parseSmokeArgs(args: string[]): RunnerOptions {
  const defaults = {
    workflow: "full" as Workflow,
    mode: "prod" as Mode,
    baseUrl: "",
    downloadDir: DEFAULT_DOWNLOAD_DIR,
    maxPolls: DEFAULT_MAX_POLLS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
  const queue = args.filter((token, index) => !(index === 0 && token === "--"));

  if (queue[0] && !queue[0].startsWith("--")) {
    defaults.workflow = parseWorkflow(queue.shift() as string);
  }

  while (queue.length > 0) {
    const token = queue.shift() as string;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const [flag, inlineValue] = token.split("=", 2);
    const value = inlineValue ?? queue.shift();

    switch (flag) {
      case "--mode":
        defaults.mode = parseMode(value);
        break;
      case "--base-url":
        defaults.baseUrl = requireFlagValue(flag, value);
        break;
      case "--download-dir":
        defaults.downloadDir = requireFlagValue(flag, value);
        break;
      case "--max-polls":
        defaults.maxPolls = parsePositiveInteger(flag, value);
        break;
      case "--poll-interval-ms":
        defaults.pollIntervalMs = parsePositiveInteger(flag, value);
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  return {
    workflow: defaults.workflow,
    mode: defaults.mode,
    baseUrl: defaults.baseUrl ||
      (defaults.mode === "local" ? LOCAL_BASE_URL : PROD_BASE_URL),
    downloadDir: defaults.downloadDir,
    maxPolls: defaults.maxPolls,
    pollIntervalMs: defaults.pollIntervalMs,
  };
}

export function buildLocalServerCommand(): string[] {
  return ["bun", "run", "start"];
}

export function assertLocalModeDatabaseEnv(
  env: Record<string, string | undefined>,
): void {
  if (env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_URL) {
    return;
  }

  throw new Error(
    "Local mode requires DATABASE_URL, POSTGRES_URL, or SUPABASE_URL.",
  );
}

export async function readEnvironmentValues(
  environmentPath: PathLike,
): Promise<EnvironmentValues> {
  const parsed = await readEnvironmentDocument(environmentPath);
  const values = Array.isArray(parsed.values) ? parsed.values : [];

  return Object.fromEntries(
    values.map((entry) => [entry.key, entry.value ?? ""]),
  );
}

export async function createWorkingEnvironmentFromDefaults(
  args: CreateWorkingEnvironmentArgs,
): Promise<string> {
  const outputDirectory = resolvePath(args.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const values: PostmanEnvironmentValue[] = Object.entries(
    DEFAULT_ENVIRONMENT_VALUES,
  ).map(([key, value]) => ({ key, value, type: "default", enabled: true }));
  upsertEnvironmentValue(values, "baseUrl", args.baseUrl);

  const doc: PostmanEnvironmentDocument = {
    name: "ATR Smoke Runner",
    values,
  };

  const workingEnvironmentPath = joinPath(
    outputDirectory,
    "working-environment.json",
  );
  await writeFile(
    workingEnvironmentPath,
    JSON.stringify(doc, null, 2),
  );

  return workingEnvironmentPath;
}

export async function runSmokeWorkflow(
  options: RunnerOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowSummary> {
  const tempRoot = await mkdtemp(join(tmpdir(), "atr-smoke-"));
  const downloadDirectory = resolveDownloadDirectory(options.downloadDir);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const log = dependencies.log ?? console.log;
  const sleepImpl = dependencies.sleepImpl ?? sleep;
  const startServer = dependencies.startLocalServer ?? startLocalServer;
  let childProcess: ChildProcess | undefined;

  try {
    const workingEnvironmentPath = await createWorkingEnvironmentFromDefaults({
      outputDirectory: tempRoot,
      baseUrl: options.baseUrl,
    });

    if (options.mode === "local") {
      assertLocalModeDatabaseEnv({
        DATABASE_URL: process.env.DATABASE_URL,
        POSTGRES_URL: process.env.POSTGRES_URL,
        SUPABASE_URL: process.env.SUPABASE_URL,
      });

      childProcess = startServer();
      await waitForServerReady(
        `${stripTrailingSlash(options.baseUrl)}/metadata`,
        fetchImpl,
        sleepImpl,
      );
    }

    const summary: WorkflowSummary = {
      downloadedArtifacts: [],
    };

    if (options.workflow === "metadata") {
      await runMetadataStep(workingEnvironmentPath, fetchImpl, log);
      return summary;
    }

    if (options.workflow === "group") {
      await runGroupStep(workingEnvironmentPath, fetchImpl, log);
      return summary;
    }

    if (options.workflow === "full") {
      await runMetadataStep(workingEnvironmentPath, fetchImpl, log);
      await runGroupStep(workingEnvironmentPath, fetchImpl, log);
    }

    if (
      options.workflow === "bulk" || options.workflow === "delete" ||
      options.workflow === "full"
    ) {
      await ensureGroupId(workingEnvironmentPath, fetchImpl, log);
      summary.bulkStatusUrl = await runBulkKickoffStep(
        workingEnvironmentPath,
        fetchImpl,
        log,
      );
      log(`Bulk status URL: ${summary.bulkStatusUrl}`);

      await pollUntilComplete({
        environmentPath: workingEnvironmentPath,
        fetchImpl,
        log,
        maxPolls: options.maxPolls,
        pollIntervalMs: options.pollIntervalMs,
        sleepImpl,
      });

      summary.downloadedArtifacts = await downloadArtifacts({
        environmentPath: workingEnvironmentPath,
        downloadDirectory,
        fetchImpl,
        log,
      });
    }

    if (options.workflow === "full") {
      await runDirectReadsStep(workingEnvironmentPath, fetchImpl, log);
      await runResourceListsStep(workingEnvironmentPath, fetchImpl, log);
      await runSearchStep(workingEnvironmentPath, fetchImpl, log);
      await runNotFoundStep(workingEnvironmentPath, fetchImpl, log);
      await runContentTypeStep(workingEnvironmentPath, fetchImpl, log);
    }

    if (options.workflow === "delete" || options.workflow === "full") {
      await runDeleteStep(workingEnvironmentPath, fetchImpl, log);
    }

    return summary;
  } finally {
    if (childProcess) {
      try {
        childProcess.kill();
      } catch {
        // Ignore a race if the process already exited.
      }

      try {
        await childProcess.exited;
      } catch {
        // Ignore shutdown races during cleanup.
      }
    }

    await rm(tempRoot, { recursive: true });
  }
}

async function runMetadataStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Smoke step: Metadata");
  const environment = await readEnvironmentValues(environmentPath);
  const response = await fetchImpl(
    joinUrl(environment.baseUrl, "metadata"),
    {
      headers: {
        Accept: "application/fhir+json",
      },
    },
  );

  if (response.status !== 200) {
    throw new Error(
      `Metadata request failed with status ${response.status}.`,
    );
  }
}

async function runGroupStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Smoke step: Group");
  const environment = await readEnvironmentValues(environmentPath);
  const discoveryUrl = new URL(joinUrl(environment.baseUrl, "Group"));
  discoveryUrl.searchParams.set("identifier", environment.groupIdentifier);
  discoveryUrl.searchParams.set("_summary", "true");

  const discoveryResponse = await fetchImpl(discoveryUrl, {
    headers: {
      Accept: "application/fhir+json",
    },
  });

  if (discoveryResponse.status !== 200) {
    throw new Error(
      `Group discovery failed with status ${discoveryResponse.status}.`,
    );
  }

  const bundle = await discoveryResponse.json() as {
    entry?: Array<{ resource?: { id?: string } }>;
  };
  const groupId = bundle.entry?.[0]?.resource?.id ?? "";
  if (!groupId) {
    throw new Error("Group discovery did not return a group id.");
  }

  await updateEnvironmentValues(environmentPath, { groupId });

  const readResponse = await fetchImpl(
    joinUrl(environment.baseUrl, `Group/${groupId}`),
    {
      headers: {
        Accept: "application/fhir+json",
      },
    },
  );

  if (readResponse.status !== 200) {
    throw new Error(`Group read failed with status ${readResponse.status}.`);
  }
}

async function ensureGroupId(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  const environment = await readEnvironmentValues(environmentPath);
  if (environment.groupId) {
    return;
  }

  await runGroupStep(environmentPath, fetchImpl, log);
}

async function runBulkKickoffStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<string> {
  log("Smoke step: Bulk Kickoff");
  const environment = await readEnvironmentValues(environmentPath);
  const kickoffUrl = new URL(
    joinUrl(
      environment.baseUrl,
      `Group/${environment.groupId}/$davinci-data-export`,
    ),
  );
  kickoffUrl.searchParams.set("exportType", environment.exportType);
  kickoffUrl.searchParams.set("_type", environment.exportTypes);

  const response = await fetchImpl(kickoffUrl, {
    headers: {
      Accept: "application/fhir+json",
    },
  });

  if (response.status !== 202) {
    throw new Error(
      `Bulk kickoff failed with status ${response.status}.`,
    );
  }

  const bulkStatusUrl = response.headers.get("content-location") ?? "";
  if (!bulkStatusUrl) {
    throw new Error("Bulk kickoff did not return a content-location header.");
  }

  await updateEnvironmentValues(environmentPath, {
    bulkStatusUrl,
    jobId: bulkStatusUrl.split("/").pop() ?? "",
    groupFileUrl: "",
    patientFileUrl: "",
    coverageFileUrl: "",
    relatedPersonFileUrl: "",
    practitionerFileUrl: "",
    practitionerRoleFileUrl: "",
    organizationFileUrl: "",
    locationFileUrl: "",
  });

  return bulkStatusUrl;
}

async function pollUntilComplete(
  args: {
    environmentPath: string;
    fetchImpl: typeof fetch;
    log: (message: string) => void;
    maxPolls: number;
    pollIntervalMs: number;
    sleepImpl: (ms: number) => Promise<void>;
  },
): Promise<void> {
  for (let attempt = 1; attempt <= args.maxPolls; attempt += 1) {
    args.log("Smoke step: Bulk Poll");
    const environment = await readEnvironmentValues(args.environmentPath);
    const response = await args.fetchImpl(environment.bulkStatusUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 200) {
      const manifest = await response.json() as {
        output?: Array<{ type?: string; url?: string }>;
      };
      const output = Array.isArray(manifest.output) ? manifest.output : [];
      const byType = Object.fromEntries(
        output
          .filter((entry) => entry.type && entry.url)
          .map((entry) => [entry.type as string, entry.url as string]),
      );

      await updateEnvironmentValues(args.environmentPath, {
        groupFileUrl: byType.Group ?? "",
        patientFileUrl: byType.Patient ?? "",
        coverageFileUrl: byType.Coverage ?? "",
        relatedPersonFileUrl: byType.RelatedPerson ?? "",
        practitionerFileUrl: byType.Practitioner ?? "",
        practitionerRoleFileUrl: byType.PractitionerRole ?? "",
        organizationFileUrl: byType.Organization ?? "",
        locationFileUrl: byType.Location ?? "",
      });
      return;
    }

    if (response.status !== 202) {
      throw new Error(
        `Bulk Poll returned unexpected status ${response.status}.`,
      );
    }

    if (attempt < args.maxPolls) {
      await args.sleepImpl(args.pollIntervalMs);
    }
  }

  const environment = await readEnvironmentValues(args.environmentPath);
  throw new Error(
    `Bulk export did not complete after ${args.maxPolls} polls. Status URL: ${environment.bulkStatusUrl}`,
  );
}

async function downloadArtifacts(
  args: {
    environmentPath: string;
    downloadDirectory: string;
    fetchImpl: typeof fetch;
    log: (message: string) => void;
  },
): Promise<string[]> {
  args.log("Smoke step: Bulk Downloads");
  const environment = await readEnvironmentValues(args.environmentPath);
  await mkdir(args.downloadDirectory, { recursive: true });

  const writtenFiles: string[] = [];

  for (const resource of RESOURCE_DOWNLOADS) {
    const url = environment[resource.envKey];
    if (!url) {
      continue;
    }

    const response = await args.fetchImpl(url);
    if (response.status !== 200) {
      throw new Error(
        `Failed to download ${resource.fileName} from ${url}: ${response.status}`,
      );
    }

    const outputPath = joinPath(args.downloadDirectory, resource.fileName);
    await writeFile(outputPath, await response.text());
    writtenFiles.push(outputPath);
  }

  return writtenFiles;
}

async function runDeleteStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Smoke step: Delete");
  const environment = await readEnvironmentValues(environmentPath);
  const bulkStatusUrl = environment.bulkStatusUrl;

  if (!bulkStatusUrl) {
    throw new Error(
      "Delete stage requires a bulkStatusUrl from a prior bulk export.",
    );
  }

  const deleteResponse = await fetchImpl(bulkStatusUrl, {
    method: "DELETE",
  });

  if (deleteResponse.status !== 202) {
    throw new Error(
      `DELETE /bulk-status returned unexpected status ${deleteResponse.status}, expected 202.`,
    );
  }

  log("DELETE returned 202 Accepted.");

  // Use a distinct caller identity to avoid poll rate-limiting from prior
  // bulk-poll stage. Accept 404 (job expired) or 429 then retry once.
  const confirmResponse = await fetchImpl(bulkStatusUrl, {
    headers: {
      Accept: "application/fhir+json",
      "x-forwarded-for": "198.51.100.99",
    },
  });

  if (confirmResponse.status === 404) {
    log("GET after DELETE confirmed 404.");
    return;
  }

  if (confirmResponse.status === 429) {
    log("GET after DELETE throttled, retrying...");
    const retryAfter = Number(confirmResponse.headers.get("retry-after")) || 1;
    await new Promise((resolve) =>
      setTimeout(resolve, retryAfter * 1000 + 100)
    );

    const retryResponse = await fetchImpl(bulkStatusUrl, {
      headers: {
        Accept: "application/fhir+json",
        "x-forwarded-for": "198.51.100.99",
      },
    });

    if (retryResponse.status !== 404) {
      throw new Error(
        `GET after DELETE (retry) returned unexpected status ${retryResponse.status}, expected 404.`,
      );
    }

    log("GET after DELETE confirmed 404 (after retry).");
    return;
  }

  throw new Error(
    `GET after DELETE returned unexpected status ${confirmResponse.status}, expected 404.`,
  );
}

const LISTABLE_RESOURCE_TYPES = [
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

async function runDirectReadsStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Smoke step: Direct Reads");
  const environment = await readEnvironmentValues(environmentPath);
  let readCount = 0;

  for (const resourceType of LISTABLE_RESOURCE_TYPES) {
    // Get the first resource from the list endpoint
    const listResponse = await fetchImpl(
      joinUrl(environment.baseUrl, resourceType),
      { headers: { Accept: "application/fhir+json" } },
    );
    const listBody = await listResponse.json() as FhirBundle;
    const firstEntry = listBody.entry?.[0]?.resource;
    if (!firstEntry?.id) {
      throw new Error(`No ${resourceType} resources found in the database.`);
    }

    // Read that specific resource by ID
    const response = await fetchImpl(
      joinUrl(environment.baseUrl, `${resourceType}/${firstEntry.id}`),
      { headers: { Accept: "application/fhir+json" } },
    );

    if (response.status !== 200) {
      throw new Error(
        `Direct read ${resourceType}/${firstEntry.id} failed with status ${response.status}, expected 200.`,
      );
    }

    const body = await response.json() as { resourceType?: string; id?: string };
    if (body.resourceType !== resourceType) {
      throw new Error(
        `Direct read ${resourceType}/${firstEntry.id} returned resourceType "${body.resourceType}", expected "${resourceType}".`,
      );
    }
    if (body.id !== firstEntry.id) {
      throw new Error(
        `Direct read ${resourceType}/${firstEntry.id} returned id "${body.id}", expected "${firstEntry.id}".`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/fhir+json")) {
      throw new Error(
        `Direct read ${resourceType}/${firstEntry.id} returned content-type "${contentType}", expected application/fhir+json.`,
      );
    }

    readCount++;
  }

  log(`  ${readCount} direct reads passed.`);
}

type FhirBundleEntry = {
  resource?: {
    resourceType?: string;
    id?: string;
    type?: Array<{ coding?: Array<{ code?: string }> }>;
    quantity?: number;
    member?: unknown[];
    beneficiary?: { reference?: string };
    payor?: Array<{ reference?: string }>;
    practitioner?: { reference?: string };
    organization?: { reference?: string };
    managingOrganization?: { reference?: string };
    patient?: { reference?: string };
    [key: string]: unknown;
  };
};

type FhirBundle = {
  resourceType?: string;
  type?: string;
  total?: number;
  entry?: FhirBundleEntry[];
};

async function fetchBundle(
  baseUrl: string,
  path: string,
  fetchImpl: typeof fetch,
): Promise<FhirBundle> {
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    headers: { Accept: "application/fhir+json" },
  });
  if (response.status !== 200) {
    throw new Error(`GET ${path} failed with status ${response.status}, expected 200.`);
  }
  const body = await response.json() as FhirBundle;
  if (body.resourceType !== "Bundle") {
    throw new Error(`GET ${path} returned resourceType "${body.resourceType}", expected "Bundle".`);
  }
  if (body.type !== "searchset") {
    throw new Error(`GET ${path} returned Bundle type "${body.type}", expected "searchset".`);
  }
  return body;
}

async function runResourceListsStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Smoke step: Resource Lists + Data Assertions");
  const environment = await readEnvironmentValues(environmentPath);
  const baseUrl = environment.baseUrl;

  // -- Every resource type returns a non-empty Bundle --
  for (const resourceType of LISTABLE_RESOURCE_TYPES) {
    const bundle = await fetchBundle(baseUrl, resourceType, fetchImpl);
    if (typeof bundle.total !== "number" || bundle.total < 1) {
      throw new Error(`List ${resourceType} returned total ${bundle.total}, expected at least 1.`);
    }
    log(`  ${resourceType}: ${bundle.total} resources.`);
  }

  // -- Group has members --
  const groupResponse = await fetchImpl(
    joinUrl(baseUrl, `Group/${environment.groupId}`),
    { headers: { Accept: "application/fhir+json" } },
  );
  const group = await groupResponse.json() as FhirBundleEntry["resource"];
  if (typeof group?.quantity !== "number" || group.quantity < 1) {
    throw new Error(`Group quantity is ${group?.quantity}, expected at least 1.`);
  }
  if (!Array.isArray(group?.member) || group.member.length < 1) {
    throw new Error(`Group has no members.`);
  }
  if (group.member.length !== group.quantity) {
    throw new Error(`Group quantity ${group.quantity} does not match member count ${group.member.length}.`);
  }
  log(`  Group: ${group.quantity} members.`);

  // -- At least one payer Organization --
  const orgBundle = await fetchBundle(baseUrl, "Organization", fetchImpl);
  const payers = (orgBundle.entry ?? []).filter((e) => {
    const types = e.resource?.type as Array<{ coding?: Array<{ code?: string }> }> | undefined;
    return types?.some((t) => t.coding?.some((c) => c.code === "payer"));
  });
  if (payers.length < 1) {
    throw new Error("No payer Organization found. Expected at least 1.");
  }
  log(`  Payer organizations: ${payers.length}.`);

  // -- Every Coverage references a Patient beneficiary + Organization payor --
  const coverageBundle = await fetchBundle(baseUrl, "Coverage", fetchImpl);
  for (const entry of coverageBundle.entry ?? []) {
    const beneficiaryRef = entry.resource?.beneficiary?.reference ?? "";
    if (!beneficiaryRef.startsWith("Patient/")) {
      throw new Error(`Coverage ${entry.resource?.id} beneficiary "${beneficiaryRef}" does not reference a Patient.`);
    }
    const payorRefs = entry.resource?.payor as Array<{ reference?: string }> | undefined;
    const firstPayor = payorRefs?.[0]?.reference ?? "";
    if (!firstPayor.startsWith("Organization/")) {
      throw new Error(`Coverage ${entry.resource?.id} payor "${firstPayor}" does not reference an Organization.`);
    }
  }
  log(`  All ${coverageBundle.total} Coverages reference Patient beneficiary + Organization payor.`);

  // -- Every PractitionerRole references Practitioner + Organization --
  const roleBundle = await fetchBundle(baseUrl, "PractitionerRole", fetchImpl);
  for (const entry of roleBundle.entry ?? []) {
    const pracRef = entry.resource?.practitioner?.reference ?? "";
    const orgRef = entry.resource?.organization?.reference ?? "";
    if (!pracRef.startsWith("Practitioner/")) {
      throw new Error(`PractitionerRole ${entry.resource?.id} practitioner "${pracRef}" does not reference a Practitioner.`);
    }
    if (!orgRef.startsWith("Organization/")) {
      throw new Error(`PractitionerRole ${entry.resource?.id} organization "${orgRef}" does not reference an Organization.`);
    }
  }
  log(`  All ${roleBundle.total} PractitionerRoles reference Practitioner + Organization.`);

  // -- Every RelatedPerson references a Patient --
  const rpBundle = await fetchBundle(baseUrl, "RelatedPerson", fetchImpl);
  for (const entry of rpBundle.entry ?? []) {
    const patRef = entry.resource?.patient?.reference ?? "";
    if (!patRef.startsWith("Patient/")) {
      throw new Error(`RelatedPerson ${entry.resource?.id} patient "${patRef}" does not reference a Patient.`);
    }
  }
  log(`  All ${rpBundle.total} RelatedPersons reference a Patient.`);

  // -- Every Location references a managing Organization --
  const locBundle = await fetchBundle(baseUrl, "Location", fetchImpl);
  for (const entry of locBundle.entry ?? []) {
    const orgRef = entry.resource?.managingOrganization?.reference ?? "";
    if (!orgRef.startsWith("Organization/")) {
      throw new Error(`Location ${entry.resource?.id} managingOrganization "${orgRef}" does not reference an Organization.`);
    }
  }
  log(`  All ${locBundle.total} Locations reference a managing Organization.`);
}

async function runSearchStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Smoke step: Search Parameters");
  const environment = await readEnvironmentValues(environmentPath);
  const baseUrl = environment.baseUrl;
  const patientRef = `Patient/${environment.patientId}`;
  const practitionerRef = `Practitioner/${environment.practitionerId}`;
  const practitionerRoleRef = `PractitionerRole/${environment.practitionerRoleId}`;
  const locationRef = `Location/${environment.locationId}`;
  let checks = 0;

  const assertNonEmpty = (bundle: FhirBundle, label: string) => {
    if ((bundle.total ?? 0) < 1) throw new Error(`${label} returned no results.`);
  };

  const assertAllMatch = (
    bundle: FhirBundle,
    label: string,
    predicate: (resource: FhirBundleEntry["resource"]) => boolean,
    predicateDescription: string,
  ) => {
    for (const entry of bundle.entry ?? []) {
      if (!predicate(entry.resource)) {
        throw new Error(`${label}: entry ${entry.resource?.id} failed assertion: ${predicateDescription}`);
      }
    }
  };

  // ── Patient search (4 checks) ────────────────────────────────────
  log("  Patient searches...");

  // 1. Patient?name=a
  const patNameBundle = await fetchBundle(baseUrl, "Patient?name=a", fetchImpl);
  assertNonEmpty(patNameBundle, "Patient?name=a");
  checks++;

  // 2. Patient?birthdate=ge1960-01-01&birthdate=le2000-12-31
  const patBdBundle = await fetchBundle(baseUrl, "Patient?birthdate=ge1960-01-01&birthdate=le2000-12-31", fetchImpl);
  assertNonEmpty(patBdBundle, "Patient?birthdate range");
  assertAllMatch(patBdBundle, "Patient?birthdate range", (r) => {
    const bd = String(r?.birthDate ?? "");
    return bd >= "1960-01-01" && bd <= "2000-12-31";
  }, "birthDate within 1960–2000");
  checks++;

  // 3. Patient?gender=female
  const patGenderBundle = await fetchBundle(baseUrl, "Patient?gender=female", fetchImpl);
  assertNonEmpty(patGenderBundle, "Patient?gender=female");
  assertAllMatch(patGenderBundle, "Patient?gender=female", (r) => r?.gender === "female", "gender is female");
  checks++;

  // 4. Patient?general-practitioner=PractitionerRole/{id}
  //    (existing patients reference PractitionerRole, not Practitioner)
  const patGpBundle = await fetchBundle(baseUrl, `Patient?general-practitioner=${practitionerRoleRef}`, fetchImpl);
  assertNonEmpty(patGpBundle, `Patient?general-practitioner=${practitionerRoleRef}`);
  assertAllMatch(patGpBundle, "Patient?general-practitioner", (r) => {
    const gps = r?.generalPractitioner as Array<{ reference?: string }> | undefined;
    return Array.isArray(gps) && gps.some((gp) => gp.reference === practitionerRoleRef);
  }, `generalPractitioner contains ${practitionerRoleRef}`);
  checks++;

  // ── Encounter search (8 checks) ─────────────────────────────────
  log("  Encounter searches...");

  // 5. Encounter?patient=Patient/{id}
  const encPatBundle = await fetchBundle(baseUrl, `Encounter?patient=${patientRef}`, fetchImpl);
  assertNonEmpty(encPatBundle, `Encounter?patient=${patientRef}`);
  assertAllMatch(encPatBundle, "Encounter?patient", (r) => {
    return (r?.subject as { reference?: string })?.reference === patientRef;
  }, `subject.reference is ${patientRef}`);
  checks++;

  // 6. Encounter?date=ge2025-01-01&date=le2025-12-31
  const encDateBundle = await fetchBundle(baseUrl, "Encounter?date=ge2025-01-01&date=le2025-12-31", fetchImpl);
  assertNonEmpty(encDateBundle, "Encounter?date range 2025");
  checks++;

  // 7. Encounter?status=finished
  const encStatusBundle = await fetchBundle(baseUrl, "Encounter?status=finished", fetchImpl);
  assertNonEmpty(encStatusBundle, "Encounter?status=finished");
  assertAllMatch(encStatusBundle, "Encounter?status=finished", (r) => r?.status === "finished", "status is finished");
  checks++;

  // 8. Encounter?type=http://www.ama-assn.org/go/cpt|99213
  const encTypeBundle = await fetchBundle(baseUrl, `Encounter?type=${encodeURIComponent("http://www.ama-assn.org/go/cpt|99213")}`, fetchImpl);
  assertNonEmpty(encTypeBundle, "Encounter?type=CPT|99213");
  assertAllMatch(encTypeBundle, "Encounter?type=CPT|99213", (r) => {
    const types = r?.type as Array<{ coding?: Array<{ system?: string; code?: string }> }> | undefined;
    return Array.isArray(types) && types.some((t) => t.coding?.some((c) => c.system === "http://www.ama-assn.org/go/cpt" && c.code?.startsWith("99213")));
  }, "type contains CPT 99213");
  checks++;

  // 9. Encounter?practitioner=Practitioner/{id}
  const encPracBundle = await fetchBundle(baseUrl, `Encounter?practitioner=${practitionerRef}`, fetchImpl);
  assertNonEmpty(encPracBundle, `Encounter?practitioner=${practitionerRef}`);
  assertAllMatch(encPracBundle, "Encounter?practitioner", (r) => {
    const participants = r?.participant as Array<{ individual?: { reference?: string } }> | undefined;
    return Array.isArray(participants) && participants.some((p) => p.individual?.reference === practitionerRef);
  }, `participant.individual.reference is ${practitionerRef}`);
  checks++;

  // 10. Encounter?location=Location/{id}
  const encLocBundle = await fetchBundle(baseUrl, `Encounter?location=${locationRef}`, fetchImpl);
  assertNonEmpty(encLocBundle, `Encounter?location=${locationRef}`);
  assertAllMatch(encLocBundle, "Encounter?location", (r) => {
    const locations = r?.location as Array<{ location?: { reference?: string } }> | undefined;
    return Array.isArray(locations) && locations.some((l) => l.location?.reference === locationRef);
  }, `location.location.reference is ${locationRef}`);
  checks++;

  // 11. Encounter?reason-code=http://hl7.org/fhir/sid/icd-10-cm|E11.9
  const encReasonBundle = await fetchBundle(baseUrl, `Encounter?reason-code=${encodeURIComponent("http://hl7.org/fhir/sid/icd-10-cm|E11.9")}`, fetchImpl);
  assertNonEmpty(encReasonBundle, "Encounter?reason-code=ICD10|E11.9");
  assertAllMatch(encReasonBundle, "Encounter?reason-code", (r) => {
    const reasons = r?.reasonCode as Array<{ coding?: Array<{ system?: string; code?: string }> }> | undefined;
    return Array.isArray(reasons) && reasons.some((rc) => rc.coding?.some((c) => c.system === "http://hl7.org/fhir/sid/icd-10-cm" && c.code?.startsWith("E11.9")));
  }, "reasonCode contains ICD-10 E11.9");
  checks++;

  // 12. Encounter combined: practitioner + date + status
  const encCombinedBundle = await fetchBundle(baseUrl, `Encounter?practitioner=${practitionerRef}&date=ge2025-01-01&status=finished`, fetchImpl);
  assertNonEmpty(encCombinedBundle, "Encounter combined (practitioner+date+status)");
  assertAllMatch(encCombinedBundle, "Encounter combined", (r) => {
    const matchStatus = r?.status === "finished";
    const participants = r?.participant as Array<{ individual?: { reference?: string } }> | undefined;
    const matchPrac = Array.isArray(participants) && participants.some((p) => p.individual?.reference === practitionerRef);
    return matchStatus && matchPrac;
  }, "status=finished AND practitioner matches");
  checks++;

  // ── Condition search (4 checks) ─────────────────────────────────
  log("  Condition searches...");

  // 13. Condition?patient=Patient/{id}
  const condPatBundle = await fetchBundle(baseUrl, `Condition?patient=${patientRef}`, fetchImpl);
  assertNonEmpty(condPatBundle, `Condition?patient=${patientRef}`);
  assertAllMatch(condPatBundle, "Condition?patient", (r) => {
    return (r?.subject as { reference?: string })?.reference === patientRef;
  }, `subject.reference is ${patientRef}`);
  checks++;

  // 14. Condition?code=http://hl7.org/fhir/sid/icd-10-cm|E11 (prefix match)
  const condCodeBundle = await fetchBundle(baseUrl, `Condition?code=${encodeURIComponent("http://hl7.org/fhir/sid/icd-10-cm|E11")}`, fetchImpl);
  assertNonEmpty(condCodeBundle, "Condition?code=ICD10|E11 prefix");
  assertAllMatch(condCodeBundle, "Condition?code=E11", (r) => {
    const code = r?.code as { coding?: Array<{ system?: string; code?: string }> } | undefined;
    return Array.isArray(code?.coding) && code.coding.some((c) => c.system === "http://hl7.org/fhir/sid/icd-10-cm" && c.code?.startsWith("E11"));
  }, "code contains ICD-10 E11*");
  checks++;

  // 15. Condition?clinical-status=active&code=http://hl7.org/fhir/sid/icd-10-cm|I10
  const condCsBundle = await fetchBundle(baseUrl, `Condition?clinical-status=active&code=${encodeURIComponent("http://hl7.org/fhir/sid/icd-10-cm|I10")}`, fetchImpl);
  assertNonEmpty(condCsBundle, "Condition?clinical-status=active&code=I10");
  assertAllMatch(condCsBundle, "Condition?clinical-status+code", (r) => {
    const cs = r?.clinicalStatus as { coding?: Array<{ code?: string }> } | undefined;
    return Array.isArray(cs?.coding) && cs.coding.some((c) => c.code === "active");
  }, "clinicalStatus is active");
  checks++;

  // 16. Condition?category=encounter-diagnosis&patient=Patient/{id}
  const condCatBundle = await fetchBundle(baseUrl, `Condition?category=encounter-diagnosis&patient=${patientRef}`, fetchImpl);
  assertNonEmpty(condCatBundle, "Condition?category=encounter-diagnosis&patient");
  assertAllMatch(condCatBundle, "Condition?category+patient", (r) => {
    const subj = (r?.subject as { reference?: string })?.reference === patientRef;
    const cats = r?.category as Array<{ coding?: Array<{ code?: string }> }> | undefined;
    const catMatch = Array.isArray(cats) && cats.some((cat) => cat.coding?.some((c) => c.code === "encounter-diagnosis"));
    return subj && catMatch;
  }, "patient matches AND category is encounter-diagnosis");
  checks++;

  // ── Procedure search (2 checks) ─────────────────────────────────
  log("  Procedure searches...");

  // 17. Procedure?patient=Patient/{id}
  const procPatBundle = await fetchBundle(baseUrl, `Procedure?patient=${patientRef}`, fetchImpl);
  assertNonEmpty(procPatBundle, `Procedure?patient=${patientRef}`);
  assertAllMatch(procPatBundle, "Procedure?patient", (r) => {
    return (r?.subject as { reference?: string })?.reference === patientRef;
  }, `subject.reference is ${patientRef}`);
  checks++;

  // 18. Procedure?code=http://www.ama-assn.org/go/cpt|99385
  const procCodeBundle = await fetchBundle(baseUrl, `Procedure?code=${encodeURIComponent("http://www.ama-assn.org/go/cpt|99385")}`, fetchImpl);
  assertNonEmpty(procCodeBundle, "Procedure?code=CPT|99385");
  assertAllMatch(procCodeBundle, "Procedure?code=99385", (r) => {
    const code = r?.code as { coding?: Array<{ system?: string; code?: string }> } | undefined;
    return Array.isArray(code?.coding) && code.coding.some((c) => c.system === "http://www.ama-assn.org/go/cpt" && c.code?.startsWith("99385"));
  }, "code contains CPT 99385");
  checks++;

  // ── Observation search (3 checks) ───────────────────────────────
  log("  Observation searches...");

  // 19. Observation?patient=Patient/{id}&category=vital-signs
  const obsVitalBundle = await fetchBundle(baseUrl, `Observation?patient=${patientRef}&category=vital-signs`, fetchImpl);
  assertNonEmpty(obsVitalBundle, "Observation?patient+category=vital-signs");
  assertAllMatch(obsVitalBundle, "Observation vitals", (r) => {
    const cats = r?.category as Array<{ coding?: Array<{ code?: string }> }> | undefined;
    return Array.isArray(cats) && cats.some((cat) => cat.coding?.some((c) => c.code === "vital-signs"));
  }, "category contains vital-signs");
  checks++;

  // 20. Observation?patient=Patient/{id}&category=laboratory
  const obsLabBundle = await fetchBundle(baseUrl, `Observation?patient=${patientRef}&category=laboratory`, fetchImpl);
  assertNonEmpty(obsLabBundle, "Observation?patient+category=laboratory");
  assertAllMatch(obsLabBundle, "Observation labs", (r) => {
    const cats = r?.category as Array<{ coding?: Array<{ code?: string }> }> | undefined;
    return Array.isArray(cats) && cats.some((cat) => cat.coding?.some((c) => c.code === "laboratory"));
  }, "category contains laboratory");
  checks++;

  // 21. Observation?code=http://loinc.org|4548-4&date=ge2025-01-01
  const obsLoincBundle = await fetchBundle(baseUrl, `Observation?code=${encodeURIComponent("http://loinc.org|4548-4")}&date=ge2025-01-01`, fetchImpl);
  assertNonEmpty(obsLoincBundle, "Observation?code=LOINC|4548-4&date>=2025");
  assertAllMatch(obsLoincBundle, "Observation LOINC 4548-4", (r) => {
    const code = r?.code as { coding?: Array<{ system?: string; code?: string }> } | undefined;
    return Array.isArray(code?.coding) && code.coding.some((c) => c.system === "http://loinc.org" && c.code === "4548-4");
  }, "code contains LOINC 4548-4");
  checks++;

  // ── MedicationRequest search (2 checks) ─────────────────────────
  log("  MedicationRequest searches...");

  // 22. MedicationRequest?patient=Patient/{id}&status=active
  const medPatBundle = await fetchBundle(baseUrl, `MedicationRequest?patient=${patientRef}&status=active`, fetchImpl);
  assertNonEmpty(medPatBundle, "MedicationRequest?patient+status=active");
  assertAllMatch(medPatBundle, "MedicationRequest?patient+status", (r) => {
    const subj = (r?.subject as { reference?: string })?.reference === patientRef;
    return subj && r?.status === "active";
  }, "subject matches AND status is active");
  checks++;

  // 23. MedicationRequest?code=http://www.nlm.nih.gov/research/umls/rxnorm|860975
  const medCodeBundle = await fetchBundle(baseUrl, `MedicationRequest?code=${encodeURIComponent("http://www.nlm.nih.gov/research/umls/rxnorm|860975")}`, fetchImpl);
  assertNonEmpty(medCodeBundle, "MedicationRequest?code=RxNorm|860975");
  assertAllMatch(medCodeBundle, "MedicationRequest?code=860975", (r) => {
    const med = r?.medicationCodeableConcept as { coding?: Array<{ system?: string; code?: string }> } | undefined;
    return Array.isArray(med?.coding) && med.coding.some((c) => c.system === "http://www.nlm.nih.gov/research/umls/rxnorm" && c.code?.startsWith("860975"));
  }, "medicationCodeableConcept contains RxNorm 860975");
  checks++;

  // ── AllergyIntolerance search (1 check) ─────────────────────────
  log("  AllergyIntolerance searches...");

  // 24. AllergyIntolerance?patient=Patient/{id}
  const allergyBundle = await fetchBundle(baseUrl, `AllergyIntolerance?patient=${patientRef}`, fetchImpl);
  assertNonEmpty(allergyBundle, `AllergyIntolerance?patient=${patientRef}`);
  assertAllMatch(allergyBundle, "AllergyIntolerance?patient", (r) => {
    return (r?.patient as { reference?: string })?.reference === patientRef;
  }, `patient.reference is ${patientRef}`);
  checks++;

  log(`  ${checks} search checks passed.`);
}

async function runNotFoundStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Smoke step: Not Found");
  const environment = await readEnvironmentValues(environmentPath);

  for (const resourceType of LISTABLE_RESOURCE_TYPES) {
    const response = await fetchImpl(
      joinUrl(environment.baseUrl, `${resourceType}/does-not-exist-999`),
      { headers: { Accept: "application/fhir+json" } },
    );

    if (response.status !== 404) {
      throw new Error(
        `Not-found ${resourceType}/does-not-exist-999 returned status ${response.status}, expected 404.`,
      );
    }

    const body = await response.json() as { resourceType?: string };
    if (body.resourceType !== "OperationOutcome") {
      throw new Error(
        `Not-found ${resourceType}/does-not-exist-999 returned resourceType "${body.resourceType}", expected "OperationOutcome".`,
      );
    }
  }

  // Unknown FHIR path
  const unknownResponse = await fetchImpl(
    joinUrl(environment.baseUrl, "FakeResource/fake-id"),
    { headers: { Accept: "application/fhir+json" } },
  );
  if (unknownResponse.status !== 404) {
    throw new Error(
      `Unknown path /fhir/FakeResource/fake-id returned status ${unknownResponse.status}, expected 404.`,
    );
  }

  // Non-FHIR root
  const rootResponse = await fetchImpl(
    environment.baseUrl.replace(/\/fhir$/, "/nonexistent"),
  );
  if (rootResponse.status !== 404) {
    throw new Error(
      `Non-FHIR path /nonexistent returned status ${rootResponse.status}, expected 404.`,
    );
  }

  log(`  ${LISTABLE_RESOURCE_TYPES.length + 2} not-found checks passed.`);
}

async function runContentTypeStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Smoke step: Content-Type Checks");
  const environment = await readEnvironmentValues(environmentPath);

  // Metadata returns application/fhir+json
  const metadataResponse = await fetchImpl(
    joinUrl(environment.baseUrl, "metadata"),
    { headers: { Accept: "application/fhir+json" } },
  );
  const metadataCt = metadataResponse.headers.get("content-type") ?? "";
  if (!metadataCt.includes("application/fhir+json")) {
    throw new Error(
      `Metadata content-type "${metadataCt}" does not include application/fhir+json.`,
    );
  }

  // Group search returns application/fhir+json
  const groupSearchResponse = await fetchImpl(
    joinUrl(environment.baseUrl, `Group?identifier=${environment.groupIdentifier}&_summary=true`),
    { headers: { Accept: "application/fhir+json" } },
  );
  const groupCt = groupSearchResponse.headers.get("content-type") ?? "";
  if (!groupCt.includes("application/fhir+json")) {
    throw new Error(
      `Group search content-type "${groupCt}" does not include application/fhir+json.`,
    );
  }

  // Health endpoint returns application/json
  const healthResponse = await fetchImpl(
    environment.baseUrl.replace(/\/fhir$/, "/health"),
  );
  if (healthResponse.status !== 200) {
    throw new Error(`Health check returned status ${healthResponse.status}, expected 200.`);
  }
  const healthBody = await healthResponse.json() as { status?: string };
  if (healthBody.status !== "ok") {
    throw new Error(`Health check returned status "${healthBody.status}", expected "ok".`);
  }

  log("  Content-type and health checks passed.");
}

function parseWorkflow(value: string): Workflow {
  if (
    value === "metadata" || value === "group" || value === "bulk" ||
    value === "delete" || value === "full"
  ) {
    return value;
  }

  throw new Error(`Unknown workflow: ${value}`);
}

function parseMode(value: string | undefined): Mode {
  const resolved = requireFlagValue("--mode", value);
  if (resolved === "prod" || resolved === "local") {
    return resolved;
  }

  throw new Error(`Unknown mode: ${resolved}`);
}

function requireFlagValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parsePositiveInteger(flag: string, value: string | undefined): number {
  const resolved = Number.parseInt(requireFlagValue(flag, value), 10);
  if (Number.isNaN(resolved) || resolved <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return resolved;
}

function resolvePath(pathLike: PathLike): string {
  if (pathLike instanceof URL) {
    return decodeURIComponent(pathLike.pathname);
  }

  return pathLike;
}

function joinPath(parent: string, child: string): string {
  if (parent.endsWith("/")) {
    return `${parent}${child}`;
  }

  return `${parent}/${child}`;
}

function joinUrl(baseUrl: string, path: string): string {
  const root = stripTrailingSlash(baseUrl);
  return `${root}/${path.replace(/^\/+/, "")}`;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function upsertEnvironmentValue(
  values: PostmanEnvironmentValue[],
  key: string,
  value: string,
): void {
  const match = values.find((entry) => entry.key === key);
  if (match) {
    match.value = value;
    return;
  }

  values.push({
    key,
    value,
    type: "default",
    enabled: true,
  });
}

function resolveDownloadDirectory(downloadDir: string): string {
  const trimmed = downloadDir.trim();
  return trimmed || DEFAULT_DOWNLOAD_DIR;
}

function startLocalServer(): ChildProcess {
  const [command, ...args] = buildLocalServerCommand();
  const proc = Bun.spawn([command, ...args], {
    env: { ...process.env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });

  return {
    kill: () => proc.kill(),
    exited: proc.exited,
  };
}

async function waitForServerReady(
  url: string,
  fetchImpl: typeof fetch,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<void> {
  const maxAttempts = 30;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the local server responds.
    }

    await sleepImpl(DEFAULT_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for local server: ${url}`);
}

async function readEnvironmentDocument(
  environmentPath: PathLike,
): Promise<PostmanEnvironmentDocument> {
  return JSON.parse(
    await readFile(resolvePath(environmentPath), "utf-8"),
  ) as PostmanEnvironmentDocument;
}

async function updateEnvironmentValues(
  environmentPath: string,
  nextValues: EnvironmentValues,
): Promise<void> {
  const parsed = await readEnvironmentDocument(environmentPath);
  const values = Array.isArray(parsed.values) ? [...parsed.values] : [];

  for (const [key, value] of Object.entries(nextValues)) {
    upsertEnvironmentValue(values, key, value);
  }

  parsed.values = values;
  await writeFile(environmentPath, JSON.stringify(parsed, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.main) {
  try {
    const options = parseSmokeArgs(process.argv.slice(2));
    const summary = await runSmokeWorkflow(options);

    if (summary.bulkStatusUrl) {
      console.log(`Final bulk status URL: ${summary.bulkStatusUrl}`);
    }

    if (summary.downloadedArtifacts.length > 0) {
      console.log("Downloaded artifacts:");
      for (const path of summary.downloadedArtifacts) {
        console.log(path);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
