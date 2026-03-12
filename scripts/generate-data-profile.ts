import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
  RawAttributionList,
  RawAttributionMember,
  RawClaim,
  RawCoverage,
  RawMemberLocation,
  RawPatient,
  RawRelatedPerson,
} from "../server/lib/raw-domain-types.ts";

const DEFAULT_MEMBER_COUNT = 200;
const SOURCE_ROOT = new URL("../data/sources/", import.meta.url);
const OUTPUT_ROOT = new URL("../data/profiles/large-200/", import.meta.url);

const pad = (value: number, width: number) =>
  value.toString().padStart(width, "0");

const structuredCloneJson = <T>(value: T): T => structuredClone(value);

const readJson = async <T>(path: URL): Promise<T> =>
  JSON.parse(await Deno.readTextFile(path)) as T;

const writeJson = async (path: URL, value: unknown) => {
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const memberId = (index: number) => `MBR${pad(index, 6)}`;
const memberNumber = (index: number) => `MBN${pad(index, 6)}`;
const medicalRecordNumber = (index: number) => `MRN${pad(index, 6)}`;
const subscriberId = (index: number) => `SUB${pad(index, 6)}`;
const patientSourceId = (index: number) => `pat-src-${pad(index, 4)}`;
const patientFhirId = (index: number) => `patient-${pad(index, 4)}`;
const coverageSourceId = (index: number) => `cov-src-${pad(index, 4)}`;
const coverageFhirId = (index: number) => `coverage-${pad(index, 4)}`;
const relatedPersonSourceId = (index: number) => `rel-src-${pad(index, 4)}`;
const relatedPersonFhirId = (index: number) => `relatedperson-${pad(index, 4)}`;
const memberLocationSourceId = (index: number) =>
  `loc-src-member-${pad(index, 4)}`;
const claimSourceId = (index: number) => `claim-src-${pad(index, 5)}`;
const claimNumber = (index: number) => `CLM${pad(index, 8)}`;
const practitionerRoleSourceId = (index: number) =>
  `prole-src-${pad(index, 3)}`;
const providerLocationSourceId = (index: number) =>
  `loc-src-provider-${pad(index, 3)}`;
const clinicOrganizationSourceId = (index: number) =>
  `org-src-clinic-${pad(index, 3)}`;

const roleIndexForMember = (index: number) => ((index - 1) % 10) + 1;
const providerLocationIndexForRole = (index: number) => ((index - 1) % 5) + 1;
const clinicOrganizationIndexForRole = (index: number) => ((index - 1) % 3) + 1;
const templateIndexFor = (index: number, length: number) =>
  ((index - 1) % length) + 1;
const isDependentMember = (index: number) => index % 3 === 0;

const updatePatient = (
  template: RawPatient,
  index: number,
): RawPatient => {
  const roleIndex = roleIndexForMember(index);
  const next = structuredCloneJson(template);
  next.sourceId = patientSourceId(index);
  next.fhirId = patientFhirId(index);
  next.memberId = memberId(index);
  next.identifiers.mrn = medicalRecordNumber(index);
  next.identifiers.memberNumber = memberNumber(index);
  next.generalPractitionerRoleSourceId = practitionerRoleSourceId(roleIndex);
  next.managingOrganizationSourceId = clinicOrganizationSourceId(
    clinicOrganizationIndexForRole(roleIndex),
  );
  next.homeLocationSourceId = memberLocationSourceId(index);
  return next;
};

const updateCoverage = (
  template: RawCoverage,
  selfTemplate: RawCoverage,
  dependentTemplate: RawCoverage,
  index: number,
): RawCoverage => {
  const next = structuredCloneJson(template);
  const dependent = isDependentMember(index);
  next.sourceId = coverageSourceId(index);
  next.fhirId = coverageFhirId(index);
  next.memberId = memberId(index);
  next.memberNumber = memberNumber(index);
  next.subscriberId = subscriberId(index);
  next.beneficiaryPatientSourceId = patientSourceId(index);
  next.policyHolderSourceId = dependent
    ? relatedPersonSourceId(index)
    : patientSourceId(index);
  next.policyHolderType = dependent ? "RelatedPerson" : "Patient";
  next.subscriberSourceId = dependent
    ? relatedPersonSourceId(index)
    : patientSourceId(index);
  next.subscriberType = dependent ? "RelatedPerson" : "Patient";
  next.relationshipCode = dependent
    ? dependentTemplate.relationshipCode
    : selfTemplate.relationshipCode;
  next.relationshipDisplay = dependent
    ? dependentTemplate.relationshipDisplay
    : selfTemplate.relationshipDisplay;
  next.dependentNumber = dependent
    ? dependentTemplate.dependentNumber
    : selfTemplate.dependentNumber;
  return next;
};

const updateRelatedPerson = (
  template: RawRelatedPerson,
  index: number,
): RawRelatedPerson => {
  const next = structuredCloneJson(template);
  next.sourceId = relatedPersonSourceId(index);
  next.fhirId = relatedPersonFhirId(index);
  next.patientSourceId = patientSourceId(index);
  return next;
};

const updateMemberLocation = (
  template: RawMemberLocation,
  index: number,
): RawMemberLocation => {
  const next = structuredCloneJson(template);
  next.sourceId = memberLocationSourceId(index);
  next.patientSourceId = patientSourceId(index);
  return next;
};

const updateClaim = (
  template: RawClaim,
  memberIndex: number,
  claimIndex: number,
): RawClaim => {
  const roleIndex = roleIndexForMember(memberIndex);
  const next = structuredCloneJson(template);
  next.sourceId = claimSourceId(claimIndex);
  next.claimNumber = claimNumber(claimIndex);
  next.memberId = memberId(memberIndex);
  next.patientSourceId = patientSourceId(memberIndex);
  next.coverageSourceId = coverageSourceId(memberIndex);
  next.renderingPractitionerRoleSourceId = practitionerRoleSourceId(roleIndex);
  next.serviceLocationSourceId = providerLocationSourceId(
    providerLocationIndexForRole(roleIndex),
  );
  next.serviceOrganizationSourceId = clinicOrganizationSourceId(
    clinicOrganizationIndexForRole(roleIndex),
  );
  return next;
};

const updateAttributionMember = (
  template: RawAttributionMember,
  index: number,
): RawAttributionMember => {
  const next = structuredCloneJson(template);
  next.memberId = memberId(index);
  next.patientSourceId = patientSourceId(index);
  next.coverageSourceId = coverageSourceId(index);
  next.practitionerRoleSourceId = practitionerRoleSourceId(
    roleIndexForMember(index),
  );
  return next;
};

const buildMemberCoverageProfile = (
  source: MemberCoverageSourceDocument,
  memberCount: number,
): MemberCoverageSourceDocument => {
  const next = structuredCloneJson(source);
  const patients = source.functions.listPatients.items;
  const coverages = source.functions.listCoverages.items;
  const relatedPersons = source.functions.listRelatedPersons.items;
  const memberLocations = source.functions.listLocations.items;
  const selfCoverageTemplate = coverages.find((item) =>
    item.policyHolderType === "Patient"
  );
  const dependentCoverageTemplate = coverages.find((item) =>
    item.policyHolderType === "RelatedPerson"
  );

  if (!selfCoverageTemplate || !dependentCoverageTemplate) {
    throw new Error(
      "Expected default member-coverage fixture to include both self and dependent coverage templates.",
    );
  }

  const nextPatients: RawPatient[] = [];
  const nextCoverages: RawCoverage[] = [];
  const nextRelatedPersons: RawRelatedPerson[] = [];
  const nextLocations: RawMemberLocation[] = [];

  for (let index = 1; index <= memberCount; index += 1) {
    const patientTemplate =
      patients[templateIndexFor(index, patients.length) - 1];
    const coverageTemplate =
      coverages[templateIndexFor(index, coverages.length) - 1];
    const locationTemplate =
      memberLocations[templateIndexFor(index, memberLocations.length) - 1];

    nextPatients.push(updatePatient(patientTemplate, index));
    nextCoverages.push(
      updateCoverage(
        coverageTemplate,
        selfCoverageTemplate,
        dependentCoverageTemplate,
        index,
      ),
    );
    nextLocations.push(updateMemberLocation(locationTemplate, index));

    if (isDependentMember(index)) {
      const relatedTemplate = relatedPersons[
        templateIndexFor(index / 3, relatedPersons.length) - 1
      ];
      nextRelatedPersons.push(updateRelatedPerson(relatedTemplate, index));
    }
  }

  next.functions.listPatients.targetCount = memberCount;
  next.functions.listPatients.idPattern = `pat-src-0001..pat-src-${
    pad(memberCount, 4)
  }`;
  next.functions.listPatients.fhirIdPattern = `patient-0001..patient-${
    pad(memberCount, 4)
  }`;
  next.functions.listPatients.items = nextPatients;

  next.functions.listCoverages.targetCount = memberCount;
  next.functions.listCoverages.idPattern = `cov-src-0001..cov-src-${
    pad(memberCount, 4)
  }`;
  next.functions.listCoverages.fhirIdPattern = `coverage-0001..coverage-${
    pad(memberCount, 4)
  }`;
  next.functions.listCoverages.items = nextCoverages;

  next.functions.listRelatedPersons.targetCount = nextRelatedPersons.length;
  next.functions.listRelatedPersons.idPattern = `rel-src-0003..rel-src-${
    pad(memberCount - (memberCount % 3), 4)
  } (deterministic dependent members only)`;
  next.functions.listRelatedPersons.fhirIdPattern =
    `relatedperson-0003..relatedperson-${
      pad(memberCount - (memberCount % 3), 4)
    }`;
  next.functions.listRelatedPersons.items = nextRelatedPersons;

  next.functions.listLocations.targetCount = memberCount;
  next.functions.listLocations.idPattern =
    `loc-src-member-0001..loc-src-member-${pad(memberCount, 4)}`;
  next.functions.listLocations.items = nextLocations;

  return next;
};

const buildClaimsAttributionProfile = (
  source: ClaimsAttributionSourceDocument,
  memberCount: number,
): ClaimsAttributionSourceDocument => {
  const next = structuredCloneJson(source);
  const claims = source.functions.listClaims.items;
  const attributionList = source.functions.listAttributionLists.items[0];
  const attributionMembers = attributionList?.members ?? [];

  if (!attributionList) {
    throw new Error(
      "Expected default claims-attribution fixture to include one attribution list.",
    );
  }

  const claimsByTemplateMember = new Map<number, RawClaim[]>();
  for (const claim of claims) {
    const index = Number.parseInt(claim.memberId.replace(/^MBR0*/, ""), 10);
    const current = claimsByTemplateMember.get(index) || [];
    current.push(claim);
    claimsByTemplateMember.set(index, current);
  }

  const nextClaims: RawClaim[] = [];
  const nextMembers: RawAttributionMember[] = [];

  for (let index = 1; index <= memberCount; index += 1) {
    const templateMemberIndex = templateIndexFor(
      index,
      attributionMembers.length,
    );
    const memberTemplate = attributionMembers[templateMemberIndex - 1];
    nextMembers.push(updateAttributionMember(memberTemplate, index));

    const claimTemplates = claimsByTemplateMember.get(templateMemberIndex);
    if (!claimTemplates || claimTemplates.length === 0) {
      throw new Error(
        `Expected claim templates for member index ${templateMemberIndex}.`,
      );
    }

    for (const claimTemplate of claimTemplates) {
      nextClaims.push(
        updateClaim(claimTemplate, index, nextClaims.length + 1),
      );
    }
  }

  const nextAttributionList: RawAttributionList = {
    ...structuredCloneJson(attributionList),
    members: nextMembers,
  };

  next.functions.listClaims.targetCount = nextClaims.length;
  next.functions.listClaims.idPattern = `claim-src-00001..claim-src-${
    pad(nextClaims.length, 5)
  }`;
  next.functions.listClaims.items = nextClaims;
  next.functions.listAttributionLists.targetCount = 1;
  next.functions.listAttributionLists.items = [nextAttributionList];

  return next;
};

const main = async () => {
  const memberCoverage = await readJson<MemberCoverageSourceDocument>(
    new URL("member-coverage-service.json", SOURCE_ROOT),
  );
  const claimsAttribution = await readJson<ClaimsAttributionSourceDocument>(
    new URL("claims-attribution-service.json", SOURCE_ROOT),
  );
  const providerDirectory = await readJson<ProviderDirectorySourceDocument>(
    new URL("provider-directory-service.json", SOURCE_ROOT),
  );

  const nextMemberCoverage = buildMemberCoverageProfile(
    memberCoverage,
    DEFAULT_MEMBER_COUNT,
  );
  const nextClaimsAttribution = buildClaimsAttributionProfile(
    claimsAttribution,
    DEFAULT_MEMBER_COUNT,
  );

  await Deno.mkdir(OUTPUT_ROOT, { recursive: true });
  await writeJson(
    new URL("member-coverage-service.json", OUTPUT_ROOT),
    nextMemberCoverage,
  );
  await writeJson(
    new URL("claims-attribution-service.json", OUTPUT_ROOT),
    nextClaimsAttribution,
  );
  await writeJson(
    new URL("provider-directory-service.json", OUTPUT_ROOT),
    providerDirectory,
  );
};

if (import.meta.main) {
  await main();
}
