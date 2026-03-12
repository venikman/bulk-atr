import { describe, expect, it } from "../test-deps.ts";
import {
  getDataProfileFromEnv,
  loadSourceDocuments,
} from "../../server/bootstrap/data-profile.ts";
import { createTestServer } from "./test-helpers.ts";

type GroupPayload = {
  resourceType: string;
  id: string;
  quantity: number;
};

type ManifestPayload = {
  output: Array<{
    type: string;
    url: string;
  }>;
};

const fullExportTypes =
  "Group,Patient,Coverage,RelatedPerson,Practitioner,PractitionerRole,Organization,Location";

const countNdjsonLines = (payload: string) =>
  payload.trim().split("\n").filter(Boolean).length;

describe("data profiles", () => {
  it("defaults to the default profile when DATA_PROFILE is unset", () => {
    expect(getDataProfileFromEnv(undefined)).toBe("default");
  });

  it("rejects unknown DATA_PROFILE values", () => {
    expect(() => getDataProfileFromEnv("large-500")).toThrow(
      /DATA_PROFILE must be one of/,
    );
  });

  it("loads the large-200 fixture with expanded member counts", () => {
    const documents = loadSourceDocuments("large-200");

    expect(documents.memberCoverage.functions.listPatients.items).toHaveLength(
      200,
    );
    expect(documents.memberCoverage.functions.listCoverages.items).toHaveLength(
      200,
    );
    expect(
      documents.memberCoverage.functions.listRelatedPersons.items,
    ).toHaveLength(66);
    expect(
      documents.memberCoverage.functions.listLocations.items,
    ).toHaveLength(200);
    expect(
      documents.claimsAttribution.functions.listClaims.items,
    ).toHaveLength(400);
  });

  it("serves a 200-member Group under the large-200 profile", async () => {
    const server = await createTestServer({ dataProfile: "large-200" });

    try {
      const groupResponse = await server.request(
        "/fhir/Group/group-2026-northwind-atr-001",
      );
      const group = (await groupResponse.json()) as GroupPayload;

      expect(groupResponse.status).toBe(200);
      expect(group.resourceType).toBe("Group");
      expect(group.id).toBe("group-2026-northwind-atr-001");
      expect(group.quantity).toBe(200);
    } finally {
      await server.cleanup();
    }
  });

  it("exports expanded ndjson counts under the large-200 profile", async () => {
    const server = await createTestServer({ dataProfile: "large-200" });

    try {
      const kickoff = await server.request(
        `/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=${fullExportTypes}`,
      );

      expect(kickoff.status).toBe(202);

      const statusResponse = await server.request(
        kickoff.headers.get("content-location") || "",
      );
      const manifest = (await statusResponse.json()) as ManifestPayload;
      expect(statusResponse.status).toBe(200);
      expect(manifest.output).toHaveLength(8);

      const countsByType = new Map<string, number>();
      for (const entry of manifest.output) {
        const fileResponse = await server.request(new URL(entry.url).pathname);
        countsByType.set(
          entry.type,
          countNdjsonLines(await fileResponse.text()),
        );
      }

      expect(countsByType.get("Group")).toBe(1);
      expect(countsByType.get("Patient")).toBe(200);
      expect(countsByType.get("Coverage")).toBe(200);
      expect(countsByType.get("RelatedPerson")).toBe(66);
    } finally {
      await server.cleanup();
    }
  });
});
