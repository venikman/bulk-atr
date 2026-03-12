export type RawAddress = {
  use?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  district: string;
  state: string;
  postalCode: string;
  country: string;
  periodStart?: string | null;
  periodEnd?: string | null;
};

export type RawOfficialName = {
  prefix?: string[];
  given: string[];
  family: string;
  suffix?: string[];
  credentialsText?: string;
};

export type RawUsualName = {
  given: string[];
  family: string;
};

export type RawPatient = {
  sourceId: string;
  fhirId: string;
  memberId: string;
  identifiers: {
    mrn: string;
    memberNumber: string;
    medicareBeneficiaryId?: string | null;
    medicaidId?: string | null;
  };
  name: {
    official: RawOfficialName;
    usual: RawUsualName;
  };
  telecom: {
    homePhone?: string | null;
    mobilePhone?: string | null;
    email?: string | null;
  };
  administrativeGender: string;
  birthDate: string;
  birthSex?: string | null;
  race?: {
    code: string;
    display: string;
    text: string;
  } | null;
  ethnicity?: {
    code: string;
    display: string;
    text: string;
  } | null;
  maritalStatus?: {
    code: string;
    display: string;
  } | null;
  address: RawAddress;
  communication?: {
    languageCode: string;
    languageDisplay: string;
    preferred: boolean;
  } | null;
  contact?: {
    relationshipCode?: string;
    relationshipDisplay: string;
    name: {
      given: string[];
      family: string;
    };
    phone?: string | null;
    addressSameAsPatient?: boolean;
  } | null;
  generalPractitionerRoleSourceId?: string | null;
  managingOrganizationSourceId?: string | null;
  homeLocationSourceId?: string | null;
};

export type RawCoverage = {
  sourceId: string;
  fhirId: string;
  memberId: string;
  beneficiaryPatientSourceId: string;
  policyHolderSourceId: string;
  policyHolderType: "Patient" | "RelatedPerson";
  subscriberSourceId: string;
  subscriberType: "Patient" | "RelatedPerson";
  subscriberId: string;
  memberNumber: string;
  dependentNumber: string;
  relationshipCode: string;
  relationshipDisplay: string;
  payorOrganizationSourceId: string;
  planCode: string;
  planDisplay: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
};

export type RawRelatedPerson = {
  sourceId: string;
  fhirId: string;
  patientSourceId: string;
  name: {
    official: {
      given: string[];
      family: string;
    };
    usual?: RawUsualName;
  };
  telecom: {
    homePhone?: string | null;
    mobilePhone?: string | null;
    email?: string | null;
  };
  gender: string;
  birthDate: string;
  birthSex?: string | null;
  relationship: {
    code: string;
    display: string;
  };
  address: RawAddress;
};

export type RawMemberLocation = {
  sourceId: string;
  patientSourceId: string;
  name: string;
  locationKind: string;
  telecom?: {
    phone?: string | null;
  };
  address: RawAddress;
};

export type RawPractitioner = {
  sourceId: string;
  fhirId: string;
  npi?: string | null;
  internalProviderId?: string | null;
  stateLicenseNumber?: string | null;
  active: boolean;
  name: {
    official: RawOfficialName;
    display: string;
  };
  gender?: string | null;
  birthDate?: string | null;
  telecom?: {
    workPhone?: string | null;
    fax?: string | null;
    email?: string | null;
  };
  address?: RawAddress | null;
  qualification?: Array<{
    qualificationId: string;
    code: string;
    display: string;
    periodStart?: string | null;
    periodEnd?: string | null;
    issuerOrganizationSourceId?: string | null;
  }>;
  communication?: Array<{
    code: string;
    display: string;
  }>;
  specialty?: {
    code: string;
    display: string;
  } | null;
  roleText?: string | null;
};

export type RawPractitionerRole = {
  sourceId: string;
  fhirId: string;
  practitionerSourceId: string;
  organizationSourceId: string;
  locationSourceIds: string[];
  roleText: string;
  specialty: {
    code: string;
    display: string;
  };
  active: boolean;
  periodStart?: string | null;
  periodEnd?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type RawOrganization = {
  sourceId: string;
  fhirId: string;
  kind: string;
  name: string;
  payerCode?: string | null;
  npi?: string | null;
  tin?: string | null;
  organizationId: string;
  phone?: string | null;
  email?: string | null;
  address: RawAddress;
};

export type RawLocation = {
  sourceId: string;
  fhirId: string;
  name: string;
  organizationSourceId: string;
  status: string;
  phone?: string | null;
  address: RawAddress;
};

export type RawClaim = {
  sourceId: string;
  claimNumber: string;
  memberId: string;
  patientSourceId: string;
  coverageSourceId: string;
  renderingPractitionerRoleSourceId: string;
  serviceOrganizationSourceId: string;
  serviceLocationSourceId: string;
  billablePeriodStart: string;
  billablePeriodEnd: string;
  claimType: string;
  diagnosisCodes: string[];
  procedureCodes: string[];
  allowedAmount: number;
  currency: string;
};

export type RawAttributionMember = {
  memberId: string;
  patientSourceId: string;
  coverageSourceId: string;
  practitionerRoleSourceId: string;
  attributionStart: string;
  attributionEnd: string;
  changeType: string;
  status: string;
  inactive: boolean;
};

export type RawAttributionList = {
  sourceId: string;
  fhirId: string;
  displayName: string;
  contractId: string;
  settlementEntityId: string;
  payerOrganizationSourceId: string;
  providerOrganizationSourceId: string;
  status: string;
  contractStart: string;
  contractEnd: string;
  members: RawAttributionMember[];
};

type RawFunctionItems<T> = {
  items: T[];
  targetCount?: number;
  idPattern?: string;
  fhirIdPattern?: string;
};

export type MemberCoverageSourceDocument = {
  functions: {
    listPatients: RawFunctionItems<RawPatient>;
    listCoverages: RawFunctionItems<RawCoverage>;
    listRelatedPersons: RawFunctionItems<RawRelatedPerson>;
    listLocations: RawFunctionItems<RawMemberLocation>;
  };
};

export type ProviderDirectorySourceDocument = {
  functions: {
    listPractitioners: RawFunctionItems<RawPractitioner>;
    listPractitionerRoles: RawFunctionItems<RawPractitionerRole>;
    listOrganizations: RawFunctionItems<RawOrganization>;
    listLocations: RawFunctionItems<RawLocation>;
  };
};

export type ClaimsAttributionSourceDocument = {
  functions: {
    listClaims: RawFunctionItems<RawClaim>;
    listAttributionLists: RawFunctionItems<RawAttributionList>;
  };
};
