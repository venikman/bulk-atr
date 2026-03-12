import { describe, expect, it } from "../test-deps.ts";
import claimsAttributionSource from "../../data/sources/claims-attribution-service.json" with {
  type: "json",
};
import memberCoverageSource from "../../data/sources/member-coverage-service.json" with {
  type: "json",
};
import providerDirectorySource from "../../data/sources/provider-directory-service.json" with {
  type: "json",
};
import { AtrResolver } from "../../server/lib/atr-resolver.ts";
import { createRawDomainStoreFromDocuments } from "../../server/lib/raw-domain-store.ts";
import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
} from "../../server/lib/raw-domain-types.ts";
import { supportedResourceTypes } from "../../server/lib/types.ts";

type ClonedDocuments = ReturnType<typeof cloneDocuments>;

type DuplicateIndexCase = {
  name: string;
  mutate: (docs: ClonedDocuments) => string;
};

const loadResolver = () => {
  const store = createRawDomainStoreFromDocuments({
    memberCoverage: structuredClone(
      memberCoverageSource,
    ) as MemberCoverageSourceDocument,
    providerDirectory: structuredClone(
      providerDirectorySource,
    ) as ProviderDirectorySourceDocument,
    claimsAttribution: structuredClone(
      claimsAttributionSource,
    ) as ClaimsAttributionSourceDocument,
  });

  return {
    store,
    resolver: new AtrResolver(store),
  };
};

const cloneDocuments = (resolver: AtrResolver) => ({
  memberCoverage: structuredClone(resolver.store.memberCoverage),
  providerDirectory: structuredClone(resolver.store.providerDirectory),
  claimsAttribution: structuredClone(resolver.store.claimsAttribution),
});

const duplicateIndexMessage = ({
  resourceType,
  keyType,
  key,
  incomingSourceId,
  existingSourceId,
}: {
  resourceType: string;
  keyType: string;
  key: string;
  incomingSourceId: string;
  existingSourceId: string;
}) =>
  `Duplicate ${resourceType} ${keyType} ${key} for incoming source row ${incomingSourceId}; already used by existing source row ${existingSourceId}.`;

const duplicateIndexCases: DuplicateIndexCase[] = [
  {
    name: "Patient source id",
    mutate: (docs) => {
      const [patient] = docs.memberCoverage.functions.listPatients.items;
      docs.memberCoverage.functions.listPatients.items.push({
        ...patient,
        fhirId: "patient-duplicate-source-id",
      });
      return duplicateIndexMessage({
        resourceType: "Patient",
        keyType: "source id",
        key: patient.sourceId,
        incomingSourceId: patient.sourceId,
        existingSourceId: patient.sourceId,
      });
    },
  },
  {
    name: "Patient FHIR id",
    mutate: (docs) => {
      const [patient] = docs.memberCoverage.functions.listPatients.items;
      docs.memberCoverage.functions.listPatients.items.push({
        ...patient,
        sourceId: "patient-source-duplicate",
      });
      return duplicateIndexMessage({
        resourceType: "Patient",
        keyType: "FHIR id",
        key: patient.fhirId,
        incomingSourceId: "patient-source-duplicate",
        existingSourceId: patient.sourceId,
      });
    },
  },
  {
    name: "Coverage source id",
    mutate: (docs) => {
      const [coverage] = docs.memberCoverage.functions.listCoverages.items;
      docs.memberCoverage.functions.listCoverages.items.push({
        ...coverage,
        fhirId: "coverage-duplicate-source-id",
      });
      return duplicateIndexMessage({
        resourceType: "Coverage",
        keyType: "source id",
        key: coverage.sourceId,
        incomingSourceId: coverage.sourceId,
        existingSourceId: coverage.sourceId,
      });
    },
  },
  {
    name: "Coverage FHIR id",
    mutate: (docs) => {
      const [coverage] = docs.memberCoverage.functions.listCoverages.items;
      docs.memberCoverage.functions.listCoverages.items.push({
        ...coverage,
        sourceId: "coverage-source-duplicate",
      });
      return duplicateIndexMessage({
        resourceType: "Coverage",
        keyType: "FHIR id",
        key: coverage.fhirId,
        incomingSourceId: "coverage-source-duplicate",
        existingSourceId: coverage.sourceId,
      });
    },
  },
  {
    name: "RelatedPerson source id",
    mutate: (docs) => {
      const [relatedPerson] =
        docs.memberCoverage.functions.listRelatedPersons.items;
      docs.memberCoverage.functions.listRelatedPersons.items.push({
        ...relatedPerson,
        fhirId: "relatedperson-duplicate-source-id",
      });
      return duplicateIndexMessage({
        resourceType: "RelatedPerson",
        keyType: "source id",
        key: relatedPerson.sourceId,
        incomingSourceId: relatedPerson.sourceId,
        existingSourceId: relatedPerson.sourceId,
      });
    },
  },
  {
    name: "RelatedPerson FHIR id",
    mutate: (docs) => {
      const [relatedPerson] =
        docs.memberCoverage.functions.listRelatedPersons.items;
      docs.memberCoverage.functions.listRelatedPersons.items.push({
        ...relatedPerson,
        sourceId: "relatedperson-source-duplicate",
      });
      return duplicateIndexMessage({
        resourceType: "RelatedPerson",
        keyType: "FHIR id",
        key: relatedPerson.fhirId,
        incomingSourceId: "relatedperson-source-duplicate",
        existingSourceId: relatedPerson.sourceId,
      });
    },
  },
  {
    name: "Practitioner source id",
    mutate: (docs) => {
      const [practitioner] =
        docs.providerDirectory.functions.listPractitioners.items;
      docs.providerDirectory.functions.listPractitioners.items.push({
        ...practitioner,
        fhirId: "practitioner-duplicate-source-id",
      });
      return duplicateIndexMessage({
        resourceType: "Practitioner",
        keyType: "source id",
        key: practitioner.sourceId,
        incomingSourceId: practitioner.sourceId,
        existingSourceId: practitioner.sourceId,
      });
    },
  },
  {
    name: "Practitioner FHIR id",
    mutate: (docs) => {
      const [practitioner] =
        docs.providerDirectory.functions.listPractitioners.items;
      docs.providerDirectory.functions.listPractitioners.items.push({
        ...practitioner,
        sourceId: "practitioner-source-duplicate",
      });
      return duplicateIndexMessage({
        resourceType: "Practitioner",
        keyType: "FHIR id",
        key: practitioner.fhirId,
        incomingSourceId: "practitioner-source-duplicate",
        existingSourceId: practitioner.sourceId,
      });
    },
  },
  {
    name: "PractitionerRole source id",
    mutate: (docs) => {
      const [role] =
        docs.providerDirectory.functions.listPractitionerRoles.items;
      docs.providerDirectory.functions.listPractitionerRoles.items.push({
        ...role,
        fhirId: "practitionerrole-duplicate-source-id",
      });
      return duplicateIndexMessage({
        resourceType: "PractitionerRole",
        keyType: "source id",
        key: role.sourceId,
        incomingSourceId: role.sourceId,
        existingSourceId: role.sourceId,
      });
    },
  },
  {
    name: "PractitionerRole FHIR id",
    mutate: (docs) => {
      const [role] =
        docs.providerDirectory.functions.listPractitionerRoles.items;
      docs.providerDirectory.functions.listPractitionerRoles.items.push({
        ...role,
        sourceId: "practitionerrole-source-duplicate",
      });
      return duplicateIndexMessage({
        resourceType: "PractitionerRole",
        keyType: "FHIR id",
        key: role.fhirId,
        incomingSourceId: "practitionerrole-source-duplicate",
        existingSourceId: role.sourceId,
      });
    },
  },
  {
    name: "Organization source id",
    mutate: (docs) => {
      const [organization] =
        docs.providerDirectory.functions.listOrganizations.items;
      docs.providerDirectory.functions.listOrganizations.items.push({
        ...organization,
        fhirId: "organization-duplicate-source-id",
      });
      return duplicateIndexMessage({
        resourceType: "Organization",
        keyType: "source id",
        key: organization.sourceId,
        incomingSourceId: organization.sourceId,
        existingSourceId: organization.sourceId,
      });
    },
  },
  {
    name: "Organization FHIR id",
    mutate: (docs) => {
      const [organization] =
        docs.providerDirectory.functions.listOrganizations.items;
      docs.providerDirectory.functions.listOrganizations.items.push({
        ...organization,
        sourceId: "organization-source-duplicate",
      });
      return duplicateIndexMessage({
        resourceType: "Organization",
        keyType: "FHIR id",
        key: organization.fhirId,
        incomingSourceId: "organization-source-duplicate",
        existingSourceId: organization.sourceId,
      });
    },
  },
  {
    name: "Location source id",
    mutate: (docs) => {
      const [location] = docs.providerDirectory.functions.listLocations.items;
      docs.providerDirectory.functions.listLocations.items.push({
        ...location,
        fhirId: "location-duplicate-source-id",
      });
      return duplicateIndexMessage({
        resourceType: "Location",
        keyType: "source id",
        key: location.sourceId,
        incomingSourceId: location.sourceId,
        existingSourceId: location.sourceId,
      });
    },
  },
  {
    name: "Location FHIR id",
    mutate: (docs) => {
      const [location] = docs.providerDirectory.functions.listLocations.items;
      docs.providerDirectory.functions.listLocations.items.push({
        ...location,
        sourceId: "location-source-duplicate",
      });
      return duplicateIndexMessage({
        resourceType: "Location",
        keyType: "FHIR id",
        key: location.fhirId,
        incomingSourceId: "location-source-duplicate",
        existingSourceId: location.sourceId,
      });
    },
  },
  {
    name: "Attribution list source id",
    mutate: (docs) => {
      const [attributionList] =
        docs.claimsAttribution.functions.listAttributionLists.items;
      docs.claimsAttribution.functions.listAttributionLists.items.push({
        ...attributionList,
        fhirId: "group-2026-northwind-atr-source-id-duplicate",
        contractId: "CTR-2026-NWACO-SOURCE-DUPLICATE",
      });
      return duplicateIndexMessage({
        resourceType: "Attribution list",
        keyType: "source id",
        key: attributionList.sourceId,
        incomingSourceId: attributionList.sourceId,
        existingSourceId: attributionList.sourceId,
      });
    },
  },
];

describe("raw-domain runtime", () => {
  it("indexes the single Group from raw source data", () => {
    const { resolver } = loadResolver();

    expect(
      resolver.findGroupsByIdentifier(
        "http://example.org/contracts|CTR-2026-NWACO-001",
      ),
    ).toHaveLength(1);
    expect(
      resolver.findGroupsByName("Northwind ACO 2026 Member Attribution List"),
    ).toHaveLength(1);

    const group = resolver.getGroupById("group-2026-northwind-atr-001");
    expect(group?.resourceType).toBe("Group");
    expect(group?.id).toBe("group-2026-northwind-atr-001");
    expect(group?.quantity).toBe(50);
  });

  it("maps dependent coverage to RelatedPerson and preserves patient guardian contact", () => {
    const { resolver } = loadResolver();

    const coverage = resolver.getResource("Coverage", "coverage-0003");
    expect(coverage).toMatchObject({
      resourceType: "Coverage",
      policyHolder: { reference: "RelatedPerson/relatedperson-0003" },
      subscriber: { reference: "RelatedPerson/relatedperson-0003" },
      beneficiary: { reference: "Patient/patient-0003" },
    });

    const patient = resolver.getResource("Patient", "patient-0003");
    expect(patient).toMatchObject({
      resourceType: "Patient",
      contact: [
        {
          relationship: [{ text: "Parent or Guardian" }],
        },
      ],
    });
  });

  it("derives Group identifiers from contract and provider organization metadata only", () => {
    const { resolver } = loadResolver();

    const group = resolver.getGroupById("group-2026-northwind-atr-001");
    expect(group).toMatchObject({
      resourceType: "Group",
      identifier: [
        {
          system: "http://example.org/contracts",
          value: "CTR-2026-NWACO-001",
        },
        {
          system: "http://hl7.org/fhir/sid/us-npi",
          value: "1992000001",
        },
        {
          system: "urn:oid:2.16.840.1.113883.4.4",
          value: "14-1111111",
        },
        {
          system: "http://example.org/settlement-entities",
          value: "NWACO-001",
        },
      ],
    });

    const exportResources = resolver.buildExportResources(
      "group-2026-northwind-atr-001",
      supportedResourceTypes,
    );
    expect(exportResources?.Location).toHaveLength(5);
    expect(exportResources).not.toHaveProperty("Claim");
  });

  it("keeps all related persons indexed for a patient when multiple source rows share the patient", () => {
    const { store } = loadResolver();
    const memberCoverage = structuredClone(store.memberCoverage);
    const providerDirectory = structuredClone(store.providerDirectory);
    const claimsAttribution = structuredClone(store.claimsAttribution);
    const patientSourceId =
      memberCoverage.functions.listRelatedPersons.items[0].patientSourceId;

    memberCoverage.functions.listRelatedPersons.items.push({
      ...memberCoverage.functions.listRelatedPersons.items[0],
      sourceId: "relatedperson-source-duplicate",
      fhirId: "relatedperson-duplicate",
    });

    const duplicateStore = createRawDomainStoreFromDocuments({
      memberCoverage,
      providerDirectory,
      claimsAttribution,
    });

    expect(
      duplicateStore.indexes.relatedPersonsByPatientSourceId.get(
        patientSourceId,
      ),
    ).toHaveLength(2);
  });

  it("fails fast when raw source links are dangling across mapped collections", () => {
    const { resolver } = loadResolver();

    const cases = [
      {
        label: "Patient.generalPractitionerRoleSourceId",
        expected: (sourceId: string) =>
          `Patient ${sourceId} field generalPractitionerRoleSourceId references missing PractitionerRole missing-role-source-id.`,
        mutate: (docs: ReturnType<typeof cloneDocuments>) => {
          const patient = docs.memberCoverage.functions.listPatients.items.find(
            (candidate) => candidate.generalPractitionerRoleSourceId,
          );
          if (!patient) {
            throw new Error(
              "Expected fixture patient with a general practitioner role source id.",
            );
          }
          patient.generalPractitionerRoleSourceId = "missing-role-source-id";
          return patient.sourceId;
        },
      },
      {
        label: "Coverage.payorOrganizationSourceId",
        expected: (sourceId: string) =>
          `Coverage ${sourceId} field payorOrganizationSourceId references missing Organization missing-org-source-id.`,
        mutate: (docs: ReturnType<typeof cloneDocuments>) => {
          const coverage = docs.memberCoverage.functions.listCoverages.items[0];
          coverage.payorOrganizationSourceId = "missing-org-source-id";
          return coverage.sourceId;
        },
      },
      {
        label: "RelatedPerson.patientSourceId",
        expected: (sourceId: string) =>
          `RelatedPerson ${sourceId} field patientSourceId references missing Patient missing-patient-source-id.`,
        mutate: (docs: ReturnType<typeof cloneDocuments>) => {
          const relatedPerson =
            docs.memberCoverage.functions.listRelatedPersons.items[0];
          relatedPerson.patientSourceId = "missing-patient-source-id";
          return relatedPerson.sourceId;
        },
      },
      {
        label: "PractitionerRole.practitionerSourceId",
        expected: (sourceId: string) =>
          `PractitionerRole ${sourceId} field practitionerSourceId references missing Practitioner missing-practitioner-source-id.`,
        mutate: (docs: ReturnType<typeof cloneDocuments>) => {
          const role =
            docs.providerDirectory.functions.listPractitionerRoles.items[0];
          role.practitionerSourceId = "missing-practitioner-source-id";
          return role.sourceId;
        },
      },
      {
        label: "Practitioner.qualification[].issuerOrganizationSourceId",
        expected: (sourceId: string) =>
          `Practitioner ${sourceId} field qualification[0].issuerOrganizationSourceId references missing Organization missing-issuer-org-source-id.`,
        mutate: (docs: ReturnType<typeof cloneDocuments>) => {
          const practitioner = docs.providerDirectory.functions
            .listPractitioners.items.find(
              (candidate) =>
                candidate.qualification?.[0]?.issuerOrganizationSourceId,
            );
          if (!practitioner?.qualification?.[0]) {
            throw new Error(
              "Expected fixture practitioner qualification with issuer organization.",
            );
          }
          practitioner.qualification[0].issuerOrganizationSourceId =
            "missing-issuer-org-source-id";
          return practitioner.sourceId;
        },
      },
      {
        label: "Location.organizationSourceId",
        expected: (sourceId: string) =>
          `Location ${sourceId} field organizationSourceId references missing Organization missing-location-org-source-id.`,
        mutate: (docs: ReturnType<typeof cloneDocuments>) => {
          const location =
            docs.providerDirectory.functions.listLocations.items[0];
          location.organizationSourceId = "missing-location-org-source-id";
          return location.sourceId;
        },
      },
      {
        label: "AttributionList.members[].practitionerRoleSourceId",
        expected: (sourceId: string) =>
          `AttributionList ${sourceId} field members[0].practitionerRoleSourceId references missing PractitionerRole missing-attribution-role-source-id.`,
        mutate: (docs: ReturnType<typeof cloneDocuments>) => {
          const attributionList =
            docs.claimsAttribution.functions.listAttributionLists.items[0];
          attributionList.members[0].practitionerRoleSourceId =
            "missing-attribution-role-source-id";
          return attributionList.sourceId;
        },
      },
      {
        label: "Claim.serviceLocationSourceId",
        expected: (sourceId: string) =>
          `Claim ${sourceId} field serviceLocationSourceId references missing Location missing-claim-location-source-id.`,
        mutate: (docs: ReturnType<typeof cloneDocuments>) => {
          const claim = docs.claimsAttribution.functions.listClaims.items[0];
          claim.serviceLocationSourceId = "missing-claim-location-source-id";
          return claim.sourceId;
        },
      },
    ];

    for (const testCase of cases) {
      const docs = cloneDocuments(resolver);
      const sourceId = testCase.mutate(docs);
      expect(() =>
        createRawDomainStoreFromDocuments({
          memberCoverage: docs.memberCoverage,
          providerDirectory: docs.providerDirectory,
          claimsAttribution: docs.claimsAttribution,
        })
      ).toThrow(testCase.expected(sourceId));
    }
  });

  it("rejects invalid coverage holder types from raw JSON before link validation falls back", () => {
    const { resolver } = loadResolver();
    const docs = cloneDocuments(resolver);
    const [coverage] = docs.memberCoverage.functions.listCoverages.items;

    coverage.policyHolderType = "Guarantor" as never;

    expect(() =>
      createRawDomainStoreFromDocuments({
        memberCoverage: docs.memberCoverage,
        providerDirectory: docs.providerDirectory,
        claimsAttribution: docs.claimsAttribution,
      })
    ).toThrow(
      `Coverage ${coverage.sourceId} field policyHolderType must be Patient or RelatedPerson. Received Guarantor.`,
    );
  });

  for (const duplicateIndexCase of duplicateIndexCases) {
    it(`rejects duplicate ${duplicateIndexCase.name} during singular index construction`, () => {
      const { resolver } = loadResolver();
      const docs = cloneDocuments(resolver);

      const expected = duplicateIndexCase.mutate(docs);

      expect(() =>
        createRawDomainStoreFromDocuments({
          memberCoverage: docs.memberCoverage,
          providerDirectory: docs.providerDirectory,
          claimsAttribution: docs.claimsAttribution,
        })
      ).toThrow(expected);
    });
  }

  it("rejects duplicate attribution list group ids during indexing", () => {
    const { resolver } = loadResolver();
    const docs = cloneDocuments(resolver);
    const [firstAttributionList] =
      docs.claimsAttribution.functions.listAttributionLists.items;

    docs.claimsAttribution.functions.listAttributionLists.items.push({
      ...firstAttributionList,
      sourceId: "atr-list-source-duplicate",
      contractId: "CTR-2026-DUPLICATE",
    });

    expect(() =>
      createRawDomainStoreFromDocuments({
        memberCoverage: docs.memberCoverage,
        providerDirectory: docs.providerDirectory,
        claimsAttribution: docs.claimsAttribution,
      })
    ).toThrow(
      `Duplicate attribution list Group id ${firstAttributionList.fhirId} for atr-list-source-duplicate; already used by ${firstAttributionList.sourceId}.`,
    );
  });
});
