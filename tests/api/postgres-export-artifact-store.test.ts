import { describe, expect, it } from "../test-deps.ts";
import { newDb } from "pg-mem";
import { PostgresExportArtifactStore } from "../../server/adapters/postgres-export-artifact-store.ts";
import { applyPendingMigrations } from "../../server/lib/migrations.ts";
import { createTestSqlClient } from "./test-sql-client.ts";

const createStore = async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql = createTestSqlClient(pool);
  await applyPendingMigrations(sql);

  return {
    sql,
    store: new PostgresExportArtifactStore(sql),
  };
};

describe("PostgresExportArtifactStore", () => {
  it("writes and reads stored manifests using stable logical keys", async () => {
    const { store } = await createStore();

    const key = await store.writeManifest(
      "11111111-1111-4111-8111-111111111111",
      {
        transactionTime: "2026-03-11T12:00:00.000Z",
        request: "http://example.test/fhir/Group/test/$davinci-data-export",
        requiresAccessToken: false,
        output: [
          {
            type: "Patient",
            fileName: "Patient-1.ndjson",
          },
        ],
        error: [],
      },
    );

    expect(key).toBe("manifests/11111111-1111-4111-8111-111111111111.json");
    await expect(store.readManifest(key)).resolves.toEqual({
      transactionTime: "2026-03-11T12:00:00.000Z",
      request: "http://example.test/fhir/Group/test/$davinci-data-export",
      requiresAccessToken: false,
      output: [
        {
          type: "Patient",
          fileName: "Patient-1.ndjson",
        },
      ],
      error: [],
    });
  });

  it("writes ndjson payloads with trailing newlines and reads them back by stable keys", async () => {
    const { store } = await createStore();

    const key = await store.writeNdjson(
      "11111111-1111-4111-8111-111111111111",
      "Patient-1.ndjson",
      [
        {
          resourceType: "Patient",
          id: "patient-0001",
        },
        {
          resourceType: "Patient",
          id: "patient-0002",
        },
      ],
    );

    expect(key).toBe(
      "files/11111111-1111-4111-8111-111111111111/Patient-1.ndjson",
    );
    await expect(store.readNdjson(key)).resolves.toBe(
      [
        JSON.stringify({
          resourceType: "Patient",
          id: "patient-0001",
        }),
        JSON.stringify({
          resourceType: "Patient",
          id: "patient-0002",
        }),
        "",
      ].join("\n"),
    );
  });

  it("throws when a requested artifact key does not exist", async () => {
    const { store } = await createStore();

    await expect(store.readNdjson("files/job-1/missing.ndjson")).rejects
      .toThrow(
        "Postgres artifact was not found.",
      );
  });
});
