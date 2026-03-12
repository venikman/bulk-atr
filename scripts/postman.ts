export const PROD_BASE_URL = "https://venikman-bulk-atr.deno.dev/fhir";
export const LOCAL_BASE_URL = "http://127.0.0.1:3001/fhir";
export const DEFAULT_DOWNLOAD_DIR = ".artifacts/postman";
export const DEFAULT_MAX_POLLS = 30;
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const EXPECTED_AUTOMATION_FOLDERS = [
  "Metadata",
  "Group",
  "Bulk Kickoff",
  "Bulk Poll",
  "Bulk Downloads",
] as const;

type Workflow = "metadata" | "group" | "bulk" | "full";
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

type PostmanCollectionFolder = {
  name?: string;
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
  environmentPath: PathLike;
  outputDirectory: PathLike;
  baseUrl: string;
};

type WorkflowSummary = {
  bulkStatusUrl?: string;
  downloadedArtifacts: string[];
};

type WorkflowDependencies = {
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  sleepImpl?: (ms: number) => Promise<void>;
  startLocalServer?: () => Deno.ChildProcess;
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

export function parsePostmanArgs(args: string[]): RunnerOptions {
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
  return ["deno", "task", "start"];
}

export function assertLocalModeDatabaseEnv(
  env: Record<string, string | undefined>,
): void {
  if (env.DATABASE_URL || env.POSTGRES_URL) {
    return;
  }

  throw new Error(
    "Local Postman mode requires DATABASE_URL or POSTGRES_URL before it can auto-start the Deno server.",
  );
}

export async function readCollectionFolderNames(
  collectionPath: PathLike,
): Promise<string[]> {
  const parsed = JSON.parse(
    await Deno.readTextFile(resolvePath(collectionPath)),
  ) as { item?: PostmanCollectionFolder[] };

  return Array.isArray(parsed.item)
    ? parsed.item.map((folder) => folder.name ?? "").filter(Boolean)
    : [];
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

export async function createWorkingEnvironmentFile(
  args: CreateWorkingEnvironmentArgs,
): Promise<string> {
  const sourcePath = resolvePath(args.environmentPath);
  const outputDirectory = resolvePath(args.outputDirectory);
  await Deno.mkdir(outputDirectory, { recursive: true });

  const parsed = await readEnvironmentDocument(sourcePath);
  const values = Array.isArray(parsed.values) ? [...parsed.values] : [];
  upsertEnvironmentValue(values, "baseUrl", args.baseUrl);
  parsed.values = values;

  const workingEnvironmentPath = joinPath(
    outputDirectory,
    "working-environment.json",
  );
  await Deno.writeTextFile(
    workingEnvironmentPath,
    JSON.stringify(parsed, null, 2),
  );

  return workingEnvironmentPath;
}

export async function runPostmanWorkflow(
  options: RunnerOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowSummary> {
  const collectionPath = resolvePath(
    new URL(
      "../docs/postman/atr-producer-local.postman_collection.json",
      import.meta.url,
    ),
  );
  const environmentPath = new URL(
    "../docs/postman/atr-producer-local.postman_environment.json",
    import.meta.url,
  );
  const folderNames = await readCollectionFolderNames(collectionPath);

  assertAutomationFolders(folderNames);

  const tempRoot = await Deno.makeTempDir({ prefix: "atr-postman-" });
  const downloadDirectory = resolveDownloadDirectory(options.downloadDir);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const log = dependencies.log ?? console.log;
  const sleepImpl = dependencies.sleepImpl ?? sleep;
  const startServer = dependencies.startLocalServer ?? startLocalServer;
  let childProcess: Deno.ChildProcess | undefined;

  try {
    const workingEnvironmentPath = await createWorkingEnvironmentFile({
      environmentPath,
      outputDirectory: tempRoot,
      baseUrl: options.baseUrl,
    });

    if (options.mode === "local") {
      assertLocalModeDatabaseEnv({
        DATABASE_URL: Deno.env.get("DATABASE_URL"),
        POSTGRES_URL: Deno.env.get("POSTGRES_URL"),
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

    if (options.workflow === "bulk" || options.workflow === "full") {
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

    return summary;
  } finally {
    if (childProcess) {
      try {
        childProcess.kill("SIGTERM");
      } catch {
        // Ignore a race if the process already exited.
      }

      try {
        await childProcess.status;
      } catch {
        // Ignore shutdown races during cleanup.
      }
    }

    await Deno.remove(tempRoot, { recursive: true });
  }
}

async function runMetadataStep(
  environmentPath: string,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<void> {
  log("Running Postman folder: Metadata");
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
  log("Running Postman folder: Group");
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
  log("Running Postman folder: Bulk Kickoff");
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
    args.log("Running Postman folder: Bulk Poll");
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
  args.log("Running Postman folder: Bulk Downloads");
  const environment = await readEnvironmentValues(args.environmentPath);
  await Deno.mkdir(args.downloadDirectory, { recursive: true });

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
    await Deno.writeTextFile(outputPath, await response.text());
    writtenFiles.push(outputPath);
  }

  return writtenFiles;
}

function parseWorkflow(value: string): Workflow {
  if (
    value === "metadata" || value === "group" || value === "bulk" ||
    value === "full"
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

function assertAutomationFolders(folderNames: string[]): void {
  const actual = JSON.stringify(folderNames);
  const expected = JSON.stringify(EXPECTED_AUTOMATION_FOLDERS);

  if (actual !== expected) {
    throw new Error(
      `Postman collection folders must be ${expected}, found ${actual}.`,
    );
  }
}

function resolveDownloadDirectory(downloadDir: string): string {
  const trimmed = downloadDir.trim();
  return trimmed || DEFAULT_DOWNLOAD_DIR;
}

function startLocalServer(): Deno.ChildProcess {
  const [command, ...args] = buildLocalServerCommand();

  return new Deno.Command(command, {
    args,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "null",
  }).spawn();
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

  throw new Error(`Timed out waiting for local Postman target: ${url}`);
}

async function readEnvironmentDocument(
  environmentPath: PathLike,
): Promise<PostmanEnvironmentDocument> {
  return JSON.parse(
    await Deno.readTextFile(resolvePath(environmentPath)),
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
  await Deno.writeTextFile(environmentPath, JSON.stringify(parsed, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.main) {
  try {
    const options = parsePostmanArgs(Deno.args);
    const summary = await runPostmanWorkflow(options);

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
    Deno.exit(1);
  }
}
