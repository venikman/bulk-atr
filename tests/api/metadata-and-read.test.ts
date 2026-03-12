import { describe, expect, it } from "../test-deps.ts";
import { createTestServer } from "./test-helpers.ts";

type CapabilityStatementPayload = {
  resourceType: string;
  fhirVersion: string;
  rest: Array<{
    resource: Array<{ type: string }>;
  }>;
};

type BundlePayload = {
  resourceType: string;
  total: number;
  entry: Array<{
    resource: { id: string };
  }>;
};

type ResourcePayload = {
  resourceType: string;
};

describe("metadata and read surface", () => {
  it("returns a small HTML landing page at / and keeps unrelated root paths 404", async () => {
    const server = await createTestServer();

    try {
      const rootResponse = await server.request("/");
      const rootBody = await rootResponse.text();

      expect(rootResponse.status).toBe(200);
      expect(rootResponse.headers.get("content-type")).toContain("text/html");
      expect(rootBody).toContain("ATR");
      expect(rootBody).toContain("/fhir/metadata");
      expect(rootBody).toContain(
        "/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&_summary=true",
      );
      expect(rootBody).toContain("/fhir/Group/group-2026-northwind-atr-001");

      const unrelatedRoot = await server.request("/foo");
      expect(unrelatedRoot.status).toBe(404);
    } finally {
      await server.cleanup();
    }
  });

  it("returns a truthful capability statement from /fhir/metadata", async () => {
    const server = await createTestServer();

    try {
      const response = await server.request("/fhir/metadata");
      const body = (await response.json()) as CapabilityStatementPayload;

      expect(response.status).toBe(200);
      expect(body.resourceType).toBe("CapabilityStatement");
      expect(body.fhirVersion).toBe("4.0.1");
      expect(
        body.rest[0].resource.some((resource: { type: string }) =>
          resource.type === "Group"
        ),
      ).toBe(true);
    } finally {
      await server.cleanup();
    }
  });

  it("supports Group discovery by identifier and linked resource reads", async () => {
    const server = await createTestServer();

    try {
      for (
        const identifier of [
          "http://example.org/contracts|CTR-2026-NWACO-001",
          "http://hl7.org/fhir/sid/us-npi|1992000001",
          "urn:oid:2.16.840.1.113883.4.4|14-1111111",
          "http://example.org/settlement-entities|NWACO-001",
        ]
      ) {
        const groupSearch = await server.request(
          `/fhir/Group?identifier=${identifier}&_summary=true`,
        );
        const bundle = (await groupSearch.json()) as BundlePayload;

        expect(groupSearch.status).toBe(200);
        expect(bundle.resourceType).toBe("Bundle");
        expect(bundle.total).toBe(1);
        expect(bundle.entry[0].resource.id).toBe(
          "group-2026-northwind-atr-001",
        );
      }

      const patientRead = await server.request("/fhir/Patient/patient-0001");
      const patient = (await patientRead.json()) as ResourcePayload;
      expect(patientRead.status).toBe(200);
      expect(patient.resourceType).toBe("Patient");

      const roleRead = await server.request(
        "/fhir/PractitionerRole/practitionerrole-001",
      );
      const role = (await roleRead.json()) as ResourcePayload;
      expect(roleRead.status).toBe(200);
      expect(role.resourceType).toBe("PractitionerRole");

      const nameSearch = await server.request(
        "/fhir/Group?name=Northwind%20ACO%202026%20Member%20Attribution%20List&_summary=true",
      );
      const byName = (await nameSearch.json()) as BundlePayload;
      expect(nameSearch.status).toBe(200);
      expect(byName.total).toBe(1);

      const conflictingSearch = await server.request(
        "/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&name=Northwind&_summary=true",
      );
      expect(conflictingSearch.status).toBe(400);

      const missingPatient = await server.request(
        "/fhir/Patient/patient-missing",
      );
      expect(missingPatient.status).toBe(404);
    } finally {
      await server.cleanup();
    }
  });
});
