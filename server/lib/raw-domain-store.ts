import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
  RawAttributionList,
  RawCoverage,
  RawLocation,
  RawOrganization,
  RawPatient,
  RawPractitioner,
  RawPractitionerRole,
  RawRelatedPerson,
} from './raw-domain-types.js';

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
    .join(',')}}`;
};

const readJsonFile = async <T>(path: string) => {
  const absolute = resolve(path);
  const content = await readFile(absolute, 'utf-8');
  return JSON.parse(content) as T;
};

const requireItems = <T>(label: string, value: unknown): T[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }

  return value as T[];
};

const pushIndexValue = <T>(index: Map<string, T[]>, key: string, value: T) => {
  const current = index.get(key) || [];
  current.push(value);
  index.set(key, current);
};

export type RawDomainStore = {
  memberCoverage: MemberCoverageSourceDocument;
  providerDirectory: ProviderDirectorySourceDocument;
  claimsAttribution: ClaimsAttributionSourceDocument;
  sourceHash: string;
  indexes: {
    patientsBySourceId: Map<string, RawPatient>;
    patientsByFhirId: Map<string, RawPatient>;
    coveragesBySourceId: Map<string, RawCoverage>;
    coveragesByFhirId: Map<string, RawCoverage>;
    relatedPersonsBySourceId: Map<string, RawRelatedPerson>;
    relatedPersonsByFhirId: Map<string, RawRelatedPerson>;
    relatedPersonsByPatientSourceId: Map<string, RawRelatedPerson>;
    practitionersBySourceId: Map<string, RawPractitioner>;
    practitionersByFhirId: Map<string, RawPractitioner>;
    rolesBySourceId: Map<string, RawPractitionerRole>;
    rolesByFhirId: Map<string, RawPractitionerRole>;
    orgsBySourceId: Map<string, RawOrganization>;
    orgsByFhirId: Map<string, RawOrganization>;
    locationsBySourceId: Map<string, RawLocation>;
    locationsByFhirId: Map<string, RawLocation>;
    attributionListsBySourceId: Map<string, RawAttributionList>;
    attributionListsByGroupId: Map<string, RawAttributionList>;
    attributionListsByIdentifier: Map<string, RawAttributionList[]>;
    attributionListsByName: Map<string, RawAttributionList[]>;
  };
};

export const createRawDomainStoreFromDocuments = ({
  memberCoverage,
  providerDirectory,
  claimsAttribution,
}: {
  memberCoverage: MemberCoverageSourceDocument;
  providerDirectory: ProviderDirectorySourceDocument;
  claimsAttribution: ClaimsAttributionSourceDocument;
}): RawDomainStore => {
  const patients = requireItems<RawPatient>(
    'memberCoverage.functions.listPatients.items',
    memberCoverage.functions?.listPatients?.items,
  );
  const coverages = requireItems<RawCoverage>(
    'memberCoverage.functions.listCoverages.items',
    memberCoverage.functions?.listCoverages?.items,
  );
  const relatedPersons = requireItems<RawRelatedPerson>(
    'memberCoverage.functions.listRelatedPersons.items',
    memberCoverage.functions?.listRelatedPersons?.items,
  );
  requireItems(
    'memberCoverage.functions.listLocations.items',
    memberCoverage.functions?.listLocations?.items,
  );

  const practitioners = requireItems<RawPractitioner>(
    'providerDirectory.functions.listPractitioners.items',
    providerDirectory.functions?.listPractitioners?.items,
  );
  const roles = requireItems<RawPractitionerRole>(
    'providerDirectory.functions.listPractitionerRoles.items',
    providerDirectory.functions?.listPractitionerRoles?.items,
  );
  const orgs = requireItems<RawOrganization>(
    'providerDirectory.functions.listOrganizations.items',
    providerDirectory.functions?.listOrganizations?.items,
  );
  const locations = requireItems<RawLocation>(
    'providerDirectory.functions.listLocations.items',
    providerDirectory.functions?.listLocations?.items,
  );

  requireItems(
    'claimsAttribution.functions.listClaims.items',
    claimsAttribution.functions?.listClaims?.items,
  );
  const attributionLists = requireItems<RawAttributionList>(
    'claimsAttribution.functions.listAttributionLists.items',
    claimsAttribution.functions?.listAttributionLists?.items,
  );

  const sourceHash = createHash('sha256')
    .update(
      stableSerialize({
        memberCoverage,
        providerDirectory,
        claimsAttribution,
      }),
    )
    .digest('hex');

  const store: RawDomainStore = {
    memberCoverage,
    providerDirectory,
    claimsAttribution,
    sourceHash,
    indexes: {
      patientsBySourceId: new Map(),
      patientsByFhirId: new Map(),
      coveragesBySourceId: new Map(),
      coveragesByFhirId: new Map(),
      relatedPersonsBySourceId: new Map(),
      relatedPersonsByFhirId: new Map(),
      relatedPersonsByPatientSourceId: new Map(),
      practitionersBySourceId: new Map(),
      practitionersByFhirId: new Map(),
      rolesBySourceId: new Map(),
      rolesByFhirId: new Map(),
      orgsBySourceId: new Map(),
      orgsByFhirId: new Map(),
      locationsBySourceId: new Map(),
      locationsByFhirId: new Map(),
      attributionListsBySourceId: new Map(),
      attributionListsByGroupId: new Map(),
      attributionListsByIdentifier: new Map(),
      attributionListsByName: new Map(),
    },
  };

  for (const patient of patients) {
    store.indexes.patientsBySourceId.set(patient.sourceId, patient);
    store.indexes.patientsByFhirId.set(patient.fhirId, patient);
  }

  for (const coverage of coverages) {
    store.indexes.coveragesBySourceId.set(coverage.sourceId, coverage);
    store.indexes.coveragesByFhirId.set(coverage.fhirId, coverage);
  }

  for (const relatedPerson of relatedPersons) {
    store.indexes.relatedPersonsBySourceId.set(relatedPerson.sourceId, relatedPerson);
    store.indexes.relatedPersonsByFhirId.set(relatedPerson.fhirId, relatedPerson);
    store.indexes.relatedPersonsByPatientSourceId.set(relatedPerson.patientSourceId, relatedPerson);
  }

  for (const practitioner of practitioners) {
    store.indexes.practitionersBySourceId.set(practitioner.sourceId, practitioner);
    store.indexes.practitionersByFhirId.set(practitioner.fhirId, practitioner);
  }

  for (const role of roles) {
    store.indexes.rolesBySourceId.set(role.sourceId, role);
    store.indexes.rolesByFhirId.set(role.fhirId, role);
  }

  for (const org of orgs) {
    store.indexes.orgsBySourceId.set(org.sourceId, org);
    store.indexes.orgsByFhirId.set(org.fhirId, org);
  }

  for (const location of locations) {
    store.indexes.locationsBySourceId.set(location.sourceId, location);
    store.indexes.locationsByFhirId.set(location.fhirId, location);
  }

  for (const attributionList of attributionLists) {
    if (!attributionList.fhirId) {
      throw new Error(`Attribution list ${attributionList.sourceId} is missing fhirId.`);
    }
    if (!attributionList.displayName) {
      throw new Error(`Attribution list ${attributionList.sourceId} is missing displayName.`);
    }

    store.indexes.attributionListsBySourceId.set(attributionList.sourceId, attributionList);
    store.indexes.attributionListsByGroupId.set(attributionList.fhirId, attributionList);
    pushIndexValue(
      store.indexes.attributionListsByIdentifier,
      `http://example.org/contracts|${attributionList.contractId}`,
      attributionList,
    );
    pushIndexValue(
      store.indexes.attributionListsByName,
      attributionList.displayName.toLowerCase(),
      attributionList,
    );
  }

  return store;
};

export const loadRawDomainStore = async ({
  memberCoveragePath,
  providerDirectoryPath,
  claimsAttributionPath,
}: {
  memberCoveragePath: string;
  providerDirectoryPath: string;
  claimsAttributionPath: string;
}) => {
  const [memberCoverage, providerDirectory, claimsAttribution] = await Promise.all([
    readJsonFile<MemberCoverageSourceDocument>(memberCoveragePath),
    readJsonFile<ProviderDirectorySourceDocument>(providerDirectoryPath),
    readJsonFile<ClaimsAttributionSourceDocument>(claimsAttributionPath),
  ]);

  return createRawDomainStoreFromDocuments({
    memberCoverage,
    providerDirectory,
    claimsAttribution,
  });
};
