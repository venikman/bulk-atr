import { describe, expect, it } from "../test-deps.ts";
import {
  assertLocalModeDatabaseEnv,
  buildLocalServerCommand,
  createWorkingEnvironmentFile,
  parsePostmanArgs,
  PROD_BASE_URL,
  readCollectionFolderNames,
  readEnvironmentValues,
  runPostmanWorkflow,
} from "../../scripts/postman.ts";
import { createTestServer } from "./test-helpers.ts";

const repoRoot = new URL("../../", import.meta.url);
const collectionPath = new URL(
  "docs/postman/atr-producer-local.postman_collection.json",
  repoRoot,
);
const environmentPath = new URL(
  "docs/postman/atr-producer-local.postman_environment.json",
  repoRoot,
);
const runWorkflowWithDependencies = runPostmanWorkflow as unknown as (
  options: {
    workflow: "full";
    mode: "prod";
    baseUrl: string;
    downloadDir: string;
    maxPolls: number;
    pollIntervalMs: number;
  },
  dependencies: {
    fetchImpl: typeof fetch;
  },
) => Promise<{ bulkStatusUrl?: string; downloadedArtifacts: string[] }>;

describe("postman runner", () => {
  it("parses production defaults for the full workflow", () => {
    expect(parsePostmanArgs(["full"])).toMatchObject({
      workflow: "full",
      mode: "prod",
      baseUrl: PROD_BASE_URL,
      maxPolls: 30,
      pollIntervalMs: 1000,
      downloadDir: ".artifacts/postman",
    });
  });

  it("ignores the deno task argument separator", () => {
    expect(parsePostmanArgs(["--", "metadata"])).toMatchObject({
      workflow: "metadata",
      mode: "prod",
      baseUrl: PROD_BASE_URL,
    });
  });

  it("fails fast for local mode without a postgres url", () => {
    expect(() =>
      assertLocalModeDatabaseEnv({
        DATABASE_URL: undefined,
        POSTGRES_URL: undefined,
      })
    ).toThrow(/DATABASE_URL|POSTGRES_URL/);
  });

  it("uses deno task start for optional local mode bootstrapping", () => {
    expect(buildLocalServerCommand()).toEqual(["deno", "task", "start"]);
  });

  it("creates a working environment file without mutating the checked-in defaults", async () => {
    const before = await readEnvironmentValues(environmentPath);
    const tempRoot = await Deno.makeTempDir({ prefix: "postman-runner-test-" });

    try {
      const workingEnvironmentPath = await createWorkingEnvironmentFile({
        environmentPath,
        outputDirectory: tempRoot,
        baseUrl: PROD_BASE_URL,
      });
      const workingValues = await readEnvironmentValues(workingEnvironmentPath);
      const after = await readEnvironmentValues(environmentPath);

      expect(workingValues.baseUrl).toBe(PROD_BASE_URL);
      expect(after.baseUrl).toBe(before.baseUrl);
      expect(after.baseUrl).toBe("https://your-deployment.example/fhir");
    } finally {
      await Deno.remove(tempRoot, { recursive: true });
    }
  });

  it("keeps automation-friendly top-level collection folders", async () => {
    expect(await readCollectionFolderNames(collectionPath)).toEqual([
      "Metadata",
      "Group",
      "Bulk Kickoff",
      "Bulk Poll",
      "Bulk Downloads",
    ]);
  });

  it("runs the full workflow with fetch and downloads ndjson artifacts", async () => {
    const server = await createTestServer();
    const downloadDir = await Deno.makeTempDir({
      prefix: "postman-downloads-",
    });

    try {
      const summary = await runWorkflowWithDependencies(
        {
          workflow: "full",
          mode: "prod",
          baseUrl: "http://example.test/fhir",
          downloadDir,
          maxPolls: 5,
          pollIntervalMs: 1,
        },
        {
          fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => {
            const request = input instanceof Request
              ? input
              : new Request(String(input), init);
            return Promise.resolve(server.app.request(request));
          },
        },
      );

      expect(summary.bulkStatusUrl).toContain("/fhir/bulk-status/");
      expect(summary.downloadedArtifacts.length).toBeGreaterThan(0);

      const patientArtifact = summary.downloadedArtifacts.find((path) =>
        path.endsWith("Patient.ndjson")
      );
      expect(patientArtifact).toBeDefined();
      expect(await Deno.readTextFile(patientArtifact!)).toContain(
        '"resourceType":"Patient"',
      );
    } finally {
      await Deno.remove(downloadDir, { recursive: true });
      await server.cleanup();
    }
  });
});
