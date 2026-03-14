import { describe, expect, it } from "../test-deps.ts";
import { createTestServer } from "./test-helpers.ts";

type CapabilityStatementPayload = {
  resourceType: string;
  fhirVersion: string;
  instantiates?: string[];
  rest: Array<{
    resource: Array<{ type: string }>;
    security?: {
      service?: Array<{
        coding: Array<{ system: string; code: string }>;
      }>;
    };
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
  it("returns a grouped API surface page at / and keeps unrelated root paths 404", async () => {
    const server = await createTestServer();

    try {
      const rootResponse = await server.request("/");
      const rootBody = await rootResponse.text();

      expect(rootResponse.status).toBe(200);
      expect(rootResponse.headers.get("content-type")).toContain("text/html");
      expect(rootBody).toContain("ATR");
      expect(rootBody).toContain("API Surface");
      expect(rootBody).toContain("Metadata");
      expect(rootBody).toContain("Group");
      expect(rootBody).toContain("Bulk Export");
      expect(rootBody).toContain("Direct Reads");
      expect(rootBody).toContain("/fhir/metadata");
      expect(rootBody).toContain(
        "/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&_summary=true",
      );
      expect(rootBody).toContain(
        "/fhir/Group?name=Northwind%20ACO%202026%20Member%20Attribution%20List&_summary=true",
      );
      expect(rootBody).toContain("/fhir/Group/group-2026-northwind-atr-001");
      expect(rootBody).toContain(
        "/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage",
      );
      expect(rootBody).toContain("/fhir/bulk-status/{jobId}");
      expect(rootBody).toContain("/fhir/bulk-files/{jobId}/{fileName}");
      expect(rootBody).toContain("/fhir/Patient/patient-0001");
      expect(rootBody).toContain("/fhir/Coverage/coverage-0001");
      expect(rootBody).toContain("/fhir/RelatedPerson/relatedperson-0003");
      expect(rootBody).toContain("/fhir/Practitioner/practitioner-001");
      expect(rootBody).toContain("/fhir/PractitionerRole/practitionerrole-001");
      expect(rootBody).toContain(
        "/fhir/Organization/organization-payer-001",
      );
      expect(rootBody).toContain("/fhir/Location/location-001");
      expect(rootBody).toContain("smart-backend");

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

  it("declares ATR producer profile in instantiates", async () => {
    const server = await createTestServer();

    try {
      const response = await server.request("/fhir/metadata");
      const body = (await response.json()) as CapabilityStatementPayload;

      expect(body.instantiates).toContain(
        "http://hl7.org/fhir/us/davinci-atr/CapabilityStatement/atr-producer",
      );
    } finally {
      await server.cleanup();
    }
  });

  it("includes SMART-on-FHIR security service in smart-backend mode", async () => {
    const server = await createTestServer("smart-backend");

    try {
      const response = await server.request("/fhir/metadata", {
        headers: {
          authorization: "Bearer dev-token",
        },
      });
      const body = (await response.json()) as CapabilityStatementPayload;

      expect(body.rest[0].security?.service).toBeDefined();
      expect(body.rest[0].security?.service?.[0]?.coding?.[0]?.code).toBe(
        "SMART-on-FHIR",
      );
    } finally {
      await server.cleanup();
    }
  });

  it("returns FHIR OperationOutcome for unknown /fhir/* paths", async () => {
    const server = await createTestServer();

    try {
      const res = await server.request("/fhir/FakeResource/fake-id");
      expect(res.status).toBe(404);
      const body = (await res.json()) as ResourcePayload;
      expect(body.resourceType).toBe("OperationOutcome");
    } finally {
      await server.cleanup();
    }
  });

  it("returns application/fhir+json content-type on 404", async () => {
    const server = await createTestServer();

    try {
      const res = await server.request("/fhir/Nope");
      expect(res.headers.get("content-type")).toContain(
        "application/fhir+json",
      );
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
