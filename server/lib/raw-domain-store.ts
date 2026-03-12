import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getGroupIdentifierTokens } from './group-identifiers.js';
import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
  RawAttributionList,
  RawClaim,
  RawCoverage,
  RawLocation,
  RawMemberLocation,
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
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON source file ${absolute}: ${message}`, { cause: error });
  }
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

const setUniqueIndexValue = <T extends { sourceId: string }>(
  index: Map<string, T>,
  key: string,
  value: T,
  resourceType: string,
  keyType: string,
) => {
  const existing = index.get(key);
  if (existing) {
    throw new Error(
      `Duplicate ${resourceType} ${keyType} ${key} for incoming source row ${value.sourceId}; already used by existing source row ${existing.sourceId}.`,
    );
  }

  index.set(key, value);
};

const buildSourceIdSet = (items: Array<{ sourceId: string }>) =>
  new Set(items.map((item) => item.sourceId));

const throwMissingLink = (
  collection: string,
  sourceId: string,
  field: string,
  targetType: string,
  targetSourceId: string,
): never => {
  throw new Error(
    `${collection} ${sourceId} field ${field} references missing ${targetType} ${targetSourceId}.`,
  );
};

const validateOptionalLink = ({
  collection,
  sourceId,
  field,
  targetType,
  targetSourceId,
  targetIndex,
}: {
  collection: string;
  sourceId: string;
  field: string;
  targetType: string;
  targetSourceId?: string | null;
  targetIndex: Set<string>;
}) => {
  if (!targetSourceId) {
    return;
  }

  if (!targetIndex.has(targetSourceId)) {
    throwMissingLink(collection, sourceId, field, targetType, targetSourceId);
  }
};

const validateRequiredLink = ({
  collection,
  sourceId,
  field,
  targetType,
  targetSourceId,
  targetIndex,
}: {
  collection: string;
  sourceId: string;
  field: string;
  targetType: string;
  targetSourceId: string;
  targetIndex: Set<string>;
}) => {
  if (!targetIndex.has(targetSourceId)) {
    throwMissingLink(collection, sourceId, field, targetType, targetSourceId);
  }
};

const validateCoverageReferenceType = ({
  sourceId,
  field,
  value,
}: {
  sourceId: string;
  field: string;
  value: string;
}) => {
  if (value === 'Patient' || value === 'RelatedPerson') {
    return;
  }

  throw new Error(
    `Coverage ${sourceId} field ${field} must be Patient or RelatedPerson. Received ${value}.`,
  );
};

const validateSourceLinks = ({
  patients,
  coverages,
  relatedPersons,
  memberLocations,
  practitioners,
  roles,
  orgs,
  locations,
  claims,
  attributionLists,
}: {
  patients: RawPatient[];
  coverages: RawCoverage[];
  relatedPersons: RawRelatedPerson[];
  memberLocations: RawMemberLocation[];
  practitioners: RawPractitioner[];
  roles: RawPractitionerRole[];
  orgs: RawOrganization[];
  locations: RawLocation[];
  claims: RawClaim[];
  attributionLists: RawAttributionList[];
}) => {
  const patientIds = buildSourceIdSet(patients);
  const coverageIds = buildSourceIdSet(coverages);
  const relatedPersonIds = buildSourceIdSet(relatedPersons);
  const memberLocationIds = buildSourceIdSet(memberLocations);
  const practitionerIds = buildSourceIdSet(practitioners);
  const roleIds = buildSourceIdSet(roles);
  const organizationIds = buildSourceIdSet(orgs);
  const locationIds = buildSourceIdSet(locations);

  for (const patient of patients) {
    validateOptionalLink({
      collection: 'Patient',
      sourceId: patient.sourceId,
      field: 'generalPractitionerRoleSourceId',
      targetType: 'PractitionerRole',
      targetSourceId: patient.generalPractitionerRoleSourceId,
      targetIndex: roleIds,
    });
    validateOptionalLink({
      collection: 'Patient',
      sourceId: patient.sourceId,
      field: 'managingOrganizationSourceId',
      targetType: 'Organization',
      targetSourceId: patient.managingOrganizationSourceId,
      targetIndex: organizationIds,
    });
    validateOptionalLink({
      collection: 'Patient',
      sourceId: patient.sourceId,
      field: 'homeLocationSourceId',
      targetType: 'MemberLocation',
      targetSourceId: patient.homeLocationSourceId,
      targetIndex: memberLocationIds,
    });
  }

  for (const coverage of coverages) {
    validateCoverageReferenceType({
      sourceId: coverage.sourceId,
      field: 'policyHolderType',
      value: coverage.policyHolderType,
    });
    validateCoverageReferenceType({
      sourceId: coverage.sourceId,
      field: 'subscriberType',
      value: coverage.subscriberType,
    });
    validateRequiredLink({
      collection: 'Coverage',
      sourceId: coverage.sourceId,
      field: 'beneficiaryPatientSourceId',
      targetType: 'Patient',
      targetSourceId: coverage.beneficiaryPatientSourceId,
      targetIndex: patientIds,
    });
    validateRequiredLink({
      collection: 'Coverage',
      sourceId: coverage.sourceId,
      field: 'policyHolderSourceId',
      targetType: coverage.policyHolderType,
      targetSourceId: coverage.policyHolderSourceId,
      targetIndex: coverage.policyHolderType === 'RelatedPerson' ? relatedPersonIds : patientIds,
    });
    validateRequiredLink({
      collection: 'Coverage',
      sourceId: coverage.sourceId,
      field: 'subscriberSourceId',
      targetType: coverage.subscriberType,
      targetSourceId: coverage.subscriberSourceId,
      targetIndex: coverage.subscriberType === 'RelatedPerson' ? relatedPersonIds : patientIds,
    });
    validateRequiredLink({
      collection: 'Coverage',
      sourceId: coverage.sourceId,
      field: 'payorOrganizationSourceId',
      targetType: 'Organization',
      targetSourceId: coverage.payorOrganizationSourceId,
      targetIndex: organizationIds,
    });
  }

  for (const relatedPerson of relatedPersons) {
    validateRequiredLink({
      collection: 'RelatedPerson',
      sourceId: relatedPerson.sourceId,
      field: 'patientSourceId',
      targetType: 'Patient',
      targetSourceId: relatedPerson.patientSourceId,
      targetIndex: patientIds,
    });
  }

  for (const role of roles) {
    validateRequiredLink({
      collection: 'PractitionerRole',
      sourceId: role.sourceId,
      field: 'practitionerSourceId',
      targetType: 'Practitioner',
      targetSourceId: role.practitionerSourceId,
      targetIndex: practitionerIds,
    });
    validateRequiredLink({
      collection: 'PractitionerRole',
      sourceId: role.sourceId,
      field: 'organizationSourceId',
      targetType: 'Organization',
      targetSourceId: role.organizationSourceId,
      targetIndex: organizationIds,
    });
    for (const [index, locationSourceId] of role.locationSourceIds.entries()) {
      validateRequiredLink({
        collection: 'PractitionerRole',
        sourceId: role.sourceId,
        field: `locationSourceIds[${index}]`,
        targetType: 'Location',
        targetSourceId: locationSourceId,
        targetIndex: locationIds,
      });
    }
  }

  for (const practitioner of practitioners) {
    practitioner.qualification?.forEach((qualification, index) => {
      validateOptionalLink({
        collection: 'Practitioner',
        sourceId: practitioner.sourceId,
        field: `qualification[${index}].issuerOrganizationSourceId`,
        targetType: 'Organization',
        targetSourceId: qualification.issuerOrganizationSourceId,
        targetIndex: organizationIds,
      });
    });
  }

  for (const location of locations) {
    validateRequiredLink({
      collection: 'Location',
      sourceId: location.sourceId,
      field: 'organizationSourceId',
      targetType: 'Organization',
      targetSourceId: location.organizationSourceId,
      targetIndex: organizationIds,
    });
  }

  for (const attributionList of attributionLists) {
    validateRequiredLink({
      collection: 'AttributionList',
      sourceId: attributionList.sourceId,
      field: 'payerOrganizationSourceId',
      targetType: 'Organization',
      targetSourceId: attributionList.payerOrganizationSourceId,
      targetIndex: organizationIds,
    });
    validateRequiredLink({
      collection: 'AttributionList',
      sourceId: attributionList.sourceId,
      field: 'providerOrganizationSourceId',
      targetType: 'Organization',
      targetSourceId: attributionList.providerOrganizationSourceId,
      targetIndex: organizationIds,
    });
    attributionList.members.forEach((member, index) => {
      validateRequiredLink({
        collection: 'AttributionList',
        sourceId: attributionList.sourceId,
        field: `members[${index}].patientSourceId`,
        targetType: 'Patient',
        targetSourceId: member.patientSourceId,
        targetIndex: patientIds,
      });
      validateRequiredLink({
        collection: 'AttributionList',
        sourceId: attributionList.sourceId,
        field: `members[${index}].coverageSourceId`,
        targetType: 'Coverage',
        targetSourceId: member.coverageSourceId,
        targetIndex: coverageIds,
      });
      validateRequiredLink({
        collection: 'AttributionList',
        sourceId: attributionList.sourceId,
        field: `members[${index}].practitionerRoleSourceId`,
        targetType: 'PractitionerRole',
        targetSourceId: member.practitionerRoleSourceId,
        targetIndex: roleIds,
      });
    });
  }

  for (const claim of claims) {
    validateRequiredLink({
      collection: 'Claim',
      sourceId: claim.sourceId,
      field: 'patientSourceId',
      targetType: 'Patient',
      targetSourceId: claim.patientSourceId,
      targetIndex: patientIds,
    });
    validateRequiredLink({
      collection: 'Claim',
      sourceId: claim.sourceId,
      field: 'coverageSourceId',
      targetType: 'Coverage',
      targetSourceId: claim.coverageSourceId,
      targetIndex: coverageIds,
    });
    validateRequiredLink({
      collection: 'Claim',
      sourceId: claim.sourceId,
      field: 'renderingPractitionerRoleSourceId',
      targetType: 'PractitionerRole',
      targetSourceId: claim.renderingPractitionerRoleSourceId,
      targetIndex: roleIds,
    });
    validateRequiredLink({
      collection: 'Claim',
      sourceId: claim.sourceId,
      field: 'serviceOrganizationSourceId',
      targetType: 'Organization',
      targetSourceId: claim.serviceOrganizationSourceId,
      targetIndex: organizationIds,
    });
    validateRequiredLink({
      collection: 'Claim',
      sourceId: claim.sourceId,
      field: 'serviceLocationSourceId',
      targetType: 'Location',
      targetSourceId: claim.serviceLocationSourceId,
      targetIndex: locationIds,
    });
  }
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
    relatedPersonsByPatientSourceId: Map<string, RawRelatedPerson[]>;
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
  const memberLocations = requireItems<RawMemberLocation>(
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

  const claims = requireItems<RawClaim>(
    'claimsAttribution.functions.listClaims.items',
    claimsAttribution.functions?.listClaims?.items,
  );
  const attributionLists = requireItems<RawAttributionList>(
    'claimsAttribution.functions.listAttributionLists.items',
    claimsAttribution.functions?.listAttributionLists?.items,
  );

  validateSourceLinks({
    patients,
    coverages,
    relatedPersons,
    memberLocations,
    practitioners,
    roles,
    orgs,
    locations,
    claims,
    attributionLists,
  });

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
    setUniqueIndexValue(
      store.indexes.patientsBySourceId,
      patient.sourceId,
      patient,
      'Patient',
      'source id',
    );
    setUniqueIndexValue(
      store.indexes.patientsByFhirId,
      patient.fhirId,
      patient,
      'Patient',
      'FHIR id',
    );
  }

  for (const coverage of coverages) {
    setUniqueIndexValue(
      store.indexes.coveragesBySourceId,
      coverage.sourceId,
      coverage,
      'Coverage',
      'source id',
    );
    setUniqueIndexValue(
      store.indexes.coveragesByFhirId,
      coverage.fhirId,
      coverage,
      'Coverage',
      'FHIR id',
    );
  }

  for (const relatedPerson of relatedPersons) {
    setUniqueIndexValue(
      store.indexes.relatedPersonsBySourceId,
      relatedPerson.sourceId,
      relatedPerson,
      'RelatedPerson',
      'source id',
    );
    setUniqueIndexValue(
      store.indexes.relatedPersonsByFhirId,
      relatedPerson.fhirId,
      relatedPerson,
      'RelatedPerson',
      'FHIR id',
    );
    pushIndexValue(
      store.indexes.relatedPersonsByPatientSourceId,
      relatedPerson.patientSourceId,
      relatedPerson,
    );
  }

  for (const practitioner of practitioners) {
    setUniqueIndexValue(
      store.indexes.practitionersBySourceId,
      practitioner.sourceId,
      practitioner,
      'Practitioner',
      'source id',
    );
    setUniqueIndexValue(
      store.indexes.practitionersByFhirId,
      practitioner.fhirId,
      practitioner,
      'Practitioner',
      'FHIR id',
    );
  }

  for (const role of roles) {
    setUniqueIndexValue(
      store.indexes.rolesBySourceId,
      role.sourceId,
      role,
      'PractitionerRole',
      'source id',
    );
    setUniqueIndexValue(
      store.indexes.rolesByFhirId,
      role.fhirId,
      role,
      'PractitionerRole',
      'FHIR id',
    );
  }

  for (const org of orgs) {
    setUniqueIndexValue(
      store.indexes.orgsBySourceId,
      org.sourceId,
      org,
      'Organization',
      'source id',
    );
    setUniqueIndexValue(store.indexes.orgsByFhirId, org.fhirId, org, 'Organization', 'FHIR id');
  }

  for (const location of locations) {
    setUniqueIndexValue(
      store.indexes.locationsBySourceId,
      location.sourceId,
      location,
      'Location',
      'source id',
    );
    setUniqueIndexValue(
      store.indexes.locationsByFhirId,
      location.fhirId,
      location,
      'Location',
      'FHIR id',
    );
  }

  for (const attributionList of attributionLists) {
    if (!attributionList.fhirId) {
      throw new Error(`Attribution list ${attributionList.sourceId} is missing fhirId.`);
    }
    if (!attributionList.displayName) {
      throw new Error(`Attribution list ${attributionList.sourceId} is missing displayName.`);
    }

    setUniqueIndexValue(
      store.indexes.attributionListsBySourceId,
      attributionList.sourceId,
      attributionList,
      'Attribution list',
      'source id',
    );
    const existingGroup = store.indexes.attributionListsByGroupId.get(attributionList.fhirId);
    if (existingGroup) {
      throw new Error(
        `Duplicate attribution list Group id ${attributionList.fhirId} for ${attributionList.sourceId}; already used by ${existingGroup.sourceId}.`,
      );
    }
    store.indexes.attributionListsByGroupId.set(attributionList.fhirId, attributionList);
    const providerOrganization =
      store.indexes.orgsBySourceId.get(attributionList.providerOrganizationSourceId) || null;
    for (const identifier of getGroupIdentifierTokens(attributionList, providerOrganization)) {
      pushIndexValue(
        store.indexes.attributionListsByIdentifier,
        `${identifier.system}|${identifier.value}`,
        attributionList,
      );
    }
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
