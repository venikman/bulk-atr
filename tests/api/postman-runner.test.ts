import { describe, expect, it } from "../test-deps.ts";
import {
  assertLocalModeDatabaseEnv,
  buildLocalServerCommand,
  buildLocalServerEnv,
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
      dataProfile: "default",
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
      dataProfile: "default",
    });
  });

  it("parses an explicit data profile for local runs", () => {
    expect(
      parsePostmanArgs([
        "metadata",
        "--mode=local",
        "--data-profile=large-200",
      ]),
    ).toMatchObject({
      workflow: "metadata",
      mode: "local",
      dataProfile: "large-200",
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

  it("adds DATA_PROFILE to the local child env only for non-default profiles", () => {
    expect(buildLocalServerEnv("default")).toEqual({});
    expect(buildLocalServerEnv("large-200")).toEqual({
      DATA_PROFILE: "large-200",
    });
  });

  it("passes the selected data profile into local auto-start", async () => {
    const originalDatabaseUrl = Deno.env.get("DATABASE_URL");
    const originalPostgresUrl = Deno.env.get("POSTGRES_URL");
    let startedWithProfile: string | null = null;

    Deno.env.set("DATABASE_URL", "postgres://local-test");
    Deno.env.delete("POSTGRES_URL");

    try {
      await runPostmanWorkflow(
        {
          workflow: "metadata",
          mode: "local",
          baseUrl: "http://example.test/fhir",
          dataProfile: "large-200",
          downloadDir: ".artifacts/postman",
          maxPolls: 1,
          pollIntervalMs: 1,
        },
        {
          fetchImpl: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({ resourceType: "CapabilityStatement" }),
                {
                  status: 200,
                  headers: {
                    "content-type": "application/fhir+json",
                  },
                },
              ),
            ),
          startLocalServer: (dataProfile) => {
            startedWithProfile = dataProfile;
            return {
              kill: () => {},
              status: Promise.resolve({ success: true, code: 0, signal: null }),
            } as Deno.ChildProcess;
          },
          sleepImpl: () => Promise.resolve(),
          log: () => {},
        },
      );
    } finally {
      if (originalDatabaseUrl) {
        Deno.env.set("DATABASE_URL", originalDatabaseUrl);
      } else {
        Deno.env.delete("DATABASE_URL");
      }

      if (originalPostgresUrl) {
        Deno.env.set("POSTGRES_URL", originalPostgresUrl);
      } else {
        Deno.env.delete("POSTGRES_URL");
      }
    }

    expect(startedWithProfile).toBe("large-200");
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
