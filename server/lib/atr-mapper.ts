import { getGroupIdentifierTokens } from './group-identifiers.js';
import type { RawDomainStore } from './raw-domain-store.js';
import type {
  RawAddress,
  RawAttributionList,
  RawCoverage,
  RawLocation,
  RawOrganization,
  RawPatient,
  RawPractitioner,
  RawPractitionerRole,
  RawRelatedPerson,
} from './raw-domain-types.js';
import type { FhirResource } from './types.js';

const compact = <T>(values: Array<T | null | undefined | false>): T[] =>
  values.filter(Boolean) as T[];

const titleCase = (value: string) =>
  value
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const toAddress = (address: RawAddress, defaultUse?: string) => ({
  use: address.use || defaultUse,
  line: compact([address.line1, address.line2 || undefined]),
  city: address.city,
  district: address.district,
  state: address.state,
  postalCode: address.postalCode,
  country: address.country,
  ...(address.periodStart || address.periodEnd
    ? {
        period: {
          ...(address.periodStart ? { start: address.periodStart } : {}),
          ...(address.periodEnd ? { end: address.periodEnd } : {}),
        },
      }
    : {}),
});

const toPatientName = (name: RawPatient['name']['official'], use: 'official' | 'usual') => ({
  use,
  ...(name.prefix ? { prefix: name.prefix } : {}),
  given: name.given,
  family: name.family,
  ...(name.suffix ? { suffix: name.suffix } : {}),
});

const toTelecom = (entries: Array<{ system: string; value?: string | null; use: string }>) =>
  compact(
    entries.map((entry) =>
      entry.value
        ? {
            system: entry.system,
            value: entry.value,
            use: entry.use,
          }
        : null,
    ),
  );

const US_CORE_RACE_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race';
const US_CORE_ETHNICITY_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';
const US_CORE_BIRTHSEX_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex';

const PROFILE_URLS = {
  Organization: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/atr-organization',
  Location: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/atr-location',
  Practitioner: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/atr-practitioner',
  PractitionerRole: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/atr-practitionerrole',
  Patient: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/atr-patient',
  RelatedPerson: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/atr-relatedperson',
  Coverage: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/atr-coverage',
  Group: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/atr-group',
} as const;

const getProfile = (resourceType: keyof typeof PROFILE_URLS) => ({
  profile: [PROFILE_URLS[resourceType]],
});

export class AtrMapper {
  readonly store: RawDomainStore;

  constructor(store: RawDomainStore) {
    this.store = store;
  }

  private getOrganizationBySourceId(sourceId?: string | null) {
    return sourceId ? this.store.indexes.orgsBySourceId.get(sourceId) || null : null;
  }

  private getPatientBySourceId(sourceId?: string | null) {
    return sourceId ? this.store.indexes.patientsBySourceId.get(sourceId) || null : null;
  }

  private getRelatedPersonBySourceId(sourceId?: string | null) {
    return sourceId ? this.store.indexes.relatedPersonsBySourceId.get(sourceId) || null : null;
  }

  private getPractitionerBySourceId(sourceId?: string | null) {
    return sourceId ? this.store.indexes.practitionersBySourceId.get(sourceId) || null : null;
  }

  private getRoleBySourceId(sourceId?: string | null) {
    return sourceId ? this.store.indexes.rolesBySourceId.get(sourceId) || null : null;
  }

  private getLocationBySourceId(sourceId?: string | null) {
    return sourceId ? this.store.indexes.locationsBySourceId.get(sourceId) || null : null;
  }

  private toOrganizationReference(sourceId?: string | null) {
    const organization = this.getOrganizationBySourceId(sourceId);
    return organization ? { reference: `Organization/${organization.fhirId}` } : undefined;
  }

  private toPatientReference(sourceId?: string | null) {
    const patient = this.getPatientBySourceId(sourceId);
    return patient ? { reference: `Patient/${patient.fhirId}` } : undefined;
  }

  private toRelatedPersonReference(sourceId?: string | null) {
    const relatedPerson = this.getRelatedPersonBySourceId(sourceId);
    return relatedPerson ? { reference: `RelatedPerson/${relatedPerson.fhirId}` } : undefined;
  }

  private toPractitionerReference(sourceId?: string | null) {
    const practitioner = this.getPractitionerBySourceId(sourceId);
    return practitioner ? { reference: `Practitioner/${practitioner.fhirId}` } : undefined;
  }

  private toRoleReference(sourceId?: string | null) {
    const role = this.getRoleBySourceId(sourceId);
    return role ? { reference: `PractitionerRole/${role.fhirId}` } : undefined;
  }

  mapOrganization(raw: RawOrganization): FhirResource {
    return {
      resourceType: 'Organization',
      id: raw.fhirId,
      meta: getProfile('Organization'),
      identifier: compact([
        {
          system: 'http://example.org/organization-id',
          value: raw.organizationId,
        },
        raw.payerCode
          ? {
              system: 'http://example.org/payer-codes',
              value: raw.payerCode,
            }
          : null,
        raw.npi
          ? {
              system: 'http://hl7.org/fhir/sid/us-npi',
              value: raw.npi,
            }
          : null,
        raw.tin
          ? {
              system: 'urn:oid:2.16.840.1.113883.4.4',
              value: raw.tin,
            }
          : null,
      ]),
      active: true,
      type: [
        {
          coding: [
            {
              system: 'http://example.org/fhir/CodeSystem/organization-kind',
              code: raw.kind,
              display: titleCase(raw.kind),
            },
          ],
          text: titleCase(raw.kind),
        },
      ],
      name: raw.name,
      telecom: toTelecom([
        { system: 'phone', value: raw.phone, use: 'work' },
        { system: 'email', value: raw.email, use: 'work' },
      ]),
      address: [toAddress(raw.address, 'work')],
    };
  }

  mapLocation(raw: RawLocation): FhirResource {
    return {
      resourceType: 'Location',
      id: raw.fhirId,
      meta: getProfile('Location'),
      status: raw.status,
      name: raw.name,
      telecom: toTelecom([{ system: 'phone', value: raw.phone, use: 'work' }]),
      address: toAddress(raw.address, 'work'),
      managingOrganization: this.toOrganizationReference(raw.organizationSourceId),
    };
  }

  mapPractitioner(raw: RawPractitioner): FhirResource {
    return {
      resourceType: 'Practitioner',
      id: raw.fhirId,
      meta: getProfile('Practitioner'),
      identifier: compact([
        raw.npi
          ? {
              system: 'http://hl7.org/fhir/sid/us-npi',
              value: raw.npi,
            }
          : null,
        raw.internalProviderId
          ? {
              system: 'http://example.org/provider-id',
              value: raw.internalProviderId,
            }
          : null,
        raw.stateLicenseNumber
          ? {
              system: 'http://example.org/provider-license',
              value: raw.stateLicenseNumber,
            }
          : null,
      ]),
      active: raw.active,
      name: [
        {
          use: 'official',
          text: raw.name.display,
          ...(raw.name.official.prefix ? { prefix: raw.name.official.prefix } : {}),
          given: raw.name.official.given,
          family: raw.name.official.family,
          ...(raw.name.official.suffix ? { suffix: raw.name.official.suffix } : {}),
        },
      ],
      telecom: toTelecom([
        { system: 'phone', value: raw.telecom?.workPhone, use: 'work' },
        { system: 'fax', value: raw.telecom?.fax, use: 'work' },
        { system: 'email', value: raw.telecom?.email, use: 'work' },
      ]),
      ...(raw.address ? { address: [toAddress(raw.address)] } : {}),
      ...(raw.gender ? { gender: raw.gender } : {}),
      ...(raw.birthDate ? { birthDate: raw.birthDate } : {}),
      ...(raw.qualification?.length
        ? {
            qualification: raw.qualification.map((qualification) => ({
              identifier: [
                {
                  system: 'http://example.org/qualification-id',
                  value: qualification.qualificationId,
                },
              ],
              code: {
                text: qualification.display,
                coding: [
                  {
                    system: 'http://example.org/fhir/CodeSystem/provider-qualification',
                    code: qualification.code,
                    display: qualification.display,
                  },
                ],
              },
              ...(qualification.periodStart || qualification.periodEnd
                ? {
                    period: {
                      ...(qualification.periodStart ? { start: qualification.periodStart } : {}),
                      ...(qualification.periodEnd ? { end: qualification.periodEnd } : {}),
                    },
                  }
                : {}),
              ...(qualification.issuerOrganizationSourceId
                ? {
                    issuer: this.toOrganizationReference(qualification.issuerOrganizationSourceId),
                  }
                : {}),
            })),
          }
        : {}),
      ...(raw.communication?.length
        ? {
            communication: raw.communication.map((entry) => ({
              coding: [
                {
                  system: 'urn:ietf:bcp:47',
                  code: entry.code,
                  display: entry.display,
                },
              ],
              text: entry.display,
            })),
          }
        : {}),
    };
  }

  mapPractitionerRole(raw: RawPractitionerRole): FhirResource {
    const practitioner = this.toPractitionerReference(raw.practitionerSourceId);
    if (!practitioner) {
      throw new Error(
        `PractitionerRole ${raw.sourceId} is missing practitioner ${raw.practitionerSourceId}.`,
      );
    }

    return {
      resourceType: 'PractitionerRole',
      id: raw.fhirId,
      meta: getProfile('PractitionerRole'),
      active: raw.active,
      ...(raw.periodStart || raw.periodEnd
        ? {
            period: {
              ...(raw.periodStart ? { start: raw.periodStart } : {}),
              ...(raw.periodEnd ? { end: raw.periodEnd } : {}),
            },
          }
        : {}),
      practitioner,
      organization: this.toOrganizationReference(raw.organizationSourceId),
      location: compact(
        raw.locationSourceIds.map((sourceId) => {
          const location = this.getLocationBySourceId(sourceId);
          return location ? { reference: `Location/${location.fhirId}` } : null;
        }),
      ),
      code: [{ text: raw.roleText }],
      specialty: [
        {
          coding: [
            {
              system: 'http://nucc.org/provider-taxonomy',
              code: raw.specialty.code,
              display: raw.specialty.display,
            },
          ],
          text: raw.specialty.display,
        },
      ],
      telecom: toTelecom([
        { system: 'phone', value: raw.phone, use: 'work' },
        { system: 'email', value: raw.email, use: 'work' },
      ]),
    };
  }

  mapPatient(raw: RawPatient): FhirResource {
    const generalPractitioner = this.toRoleReference(raw.generalPractitionerRoleSourceId);

    return {
      resourceType: 'Patient',
      id: raw.fhirId,
      meta: getProfile('Patient'),
      extension: compact([
        raw.race
          ? {
              url: US_CORE_RACE_URL,
              extension: [
                {
                  url: 'ombCategory',
                  valueCoding: {
                    system: 'urn:oid:2.16.840.1.113883.6.238',
                    code: raw.race.code,
                    display: raw.race.display,
                  },
                },
                {
                  url: 'text',
                  valueString: raw.race.text,
                },
              ],
            }
          : null,
        raw.ethnicity
          ? {
              url: US_CORE_ETHNICITY_URL,
              extension: [
                {
                  url: 'ombCategory',
                  valueCoding: {
                    system: 'urn:oid:2.16.840.1.113883.6.238',
                    code: raw.ethnicity.code,
                    display: raw.ethnicity.display,
                  },
                },
                {
                  url: 'text',
                  valueString: raw.ethnicity.text,
                },
              ],
            }
          : null,
        raw.birthSex
          ? {
              url: US_CORE_BIRTHSEX_URL,
              valueCode: raw.birthSex,
            }
          : null,
      ]),
      identifier: compact([
        {
          system: 'http://example.org/member-coverage-service/mrn',
          value: raw.identifiers.mrn,
        },
        {
          system: 'http://example.org/member-coverage-service/member-id',
          value: raw.memberId,
        },
        {
          system: 'http://example.org/member-coverage-service/member-number',
          value: raw.identifiers.memberNumber,
        },
        raw.identifiers.medicareBeneficiaryId
          ? {
              system: 'http://hl7.org/fhir/sid/us-mbi',
              value: raw.identifiers.medicareBeneficiaryId,
            }
          : null,
        raw.identifiers.medicaidId
          ? {
              system: 'http://example.org/member-coverage-service/medicaid-id',
              value: raw.identifiers.medicaidId,
            }
          : null,
      ]),
      active: true,
      name: [
        toPatientName(raw.name.official, 'official'),
        {
          use: 'usual',
          given: raw.name.usual.given,
          family: raw.name.usual.family,
        },
      ],
      telecom: toTelecom([
        { system: 'phone', value: raw.telecom.homePhone, use: 'home' },
        { system: 'phone', value: raw.telecom.mobilePhone, use: 'mobile' },
        { system: 'email', value: raw.telecom.email, use: 'home' },
      ]),
      gender: raw.administrativeGender,
      birthDate: raw.birthDate,
      ...(raw.maritalStatus
        ? {
            maritalStatus: {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus',
                  code: raw.maritalStatus.code,
                  display: raw.maritalStatus.display,
                },
              ],
              text: raw.maritalStatus.display,
            },
          }
        : {}),
      address: [toAddress(raw.address)],
      ...(raw.communication
        ? {
            communication: [
              {
                language: {
                  coding: [
                    {
                      system: 'urn:ietf:bcp:47',
                      code: raw.communication.languageCode,
                      display: raw.communication.languageDisplay,
                    },
                  ],
                  text: raw.communication.languageDisplay,
                },
                preferred: raw.communication.preferred,
              },
            ],
          }
        : {}),
      ...(raw.contact
        ? {
            contact: [
              {
                relationship: [{ text: raw.contact.relationshipDisplay }],
                name: {
                  given: raw.contact.name.given,
                  family: raw.contact.name.family,
                },
                telecom: toTelecom([{ system: 'phone', value: raw.contact.phone, use: 'mobile' }]),
                ...(raw.contact.addressSameAsPatient
                  ? {
                      address: toAddress(raw.address),
                    }
                  : {}),
              },
            ],
          }
        : {}),
      ...(generalPractitioner
        ? {
            generalPractitioner: [generalPractitioner],
          }
        : {}),
      ...(raw.managingOrganizationSourceId
        ? {
            managingOrganization: this.toOrganizationReference(raw.managingOrganizationSourceId),
          }
        : {}),
    };
  }

  mapRelatedPerson(raw: RawRelatedPerson): FhirResource {
    return {
      resourceType: 'RelatedPerson',
      id: raw.fhirId,
      meta: getProfile('RelatedPerson'),
      patient: this.toPatientReference(raw.patientSourceId),
      relationship: [{ text: raw.relationship.display }],
      name: [
        {
          use: 'official',
          given: raw.name.official.given,
          family: raw.name.official.family,
        },
      ],
      telecom: toTelecom([
        { system: 'phone', value: raw.telecom.homePhone, use: 'home' },
        { system: 'phone', value: raw.telecom.mobilePhone, use: 'mobile' },
        { system: 'email', value: raw.telecom.email, use: 'home' },
      ]),
      gender: raw.gender,
      birthDate: raw.birthDate,
      address: [toAddress(raw.address)],
    };
  }

  mapCoverage(raw: RawCoverage): FhirResource {
    const payor = this.toOrganizationReference(raw.payorOrganizationSourceId);

    return {
      resourceType: 'Coverage',
      id: raw.fhirId,
      meta: getProfile('Coverage'),
      extension: [
        {
          url: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/ext-insuranceProductType',
          valueCodeableConcept: {
            coding: [
              {
                system: 'http://example.org/fhir/CodeSystem/insurance-product-type',
                code: raw.planCode,
                display: raw.planDisplay,
              },
            ],
            text: raw.planDisplay,
          },
        },
      ],
      identifier: [
        {
          system: 'http://example.org/member-coverage-service/member-number',
          value: raw.memberNumber,
        },
      ],
      status: 'active',
      policyHolder:
        raw.policyHolderType === 'RelatedPerson'
          ? this.toRelatedPersonReference(raw.policyHolderSourceId)
          : this.toPatientReference(raw.policyHolderSourceId),
      subscriber:
        raw.subscriberType === 'RelatedPerson'
          ? this.toRelatedPersonReference(raw.subscriberSourceId)
          : this.toPatientReference(raw.subscriberSourceId),
      subscriberId: raw.subscriberId,
      beneficiary: this.toPatientReference(raw.beneficiaryPatientSourceId),
      dependent: raw.dependentNumber,
      relationship: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship',
            code: raw.relationshipCode,
            display: raw.relationshipDisplay,
          },
        ],
        text: raw.relationshipDisplay,
      },
      period: {
        start: raw.periodStart,
        end: raw.periodEnd,
      },
      ...(payor
        ? {
            payor: [payor],
          }
        : {}),
      class: [
        {
          type: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/coverage-class',
                code: 'plan',
                display: 'Plan',
              },
            ],
            text: 'Plan',
          },
          value: raw.planId,
          name: raw.planDisplay,
        },
      ],
    };
  }

  mapGroup(raw: RawAttributionList): FhirResource {
    const providerOrganization = this.getOrganizationBySourceId(raw.providerOrganizationSourceId);

    return {
      resourceType: 'Group',
      id: raw.fhirId,
      meta: getProfile('Group'),
      extension: [
        {
          url: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/ext-contractValidityPeriod',
          valuePeriod: {
            start: raw.contractStart,
            end: raw.contractEnd,
          },
        },
        {
          url: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/ext-attributionListStatus',
          valueCode: raw.status,
        },
      ],
      identifier: getGroupIdentifierTokens(raw, providerOrganization),
      active: true,
      type: 'person',
      actual: true,
      name: raw.displayName,
      quantity: raw.members.length,
      member: raw.members.map((member) => {
        const coverage = this.store.indexes.coveragesBySourceId.get(member.coverageSourceId);
        const role = this.store.indexes.rolesBySourceId.get(member.practitionerRoleSourceId);

        return {
          extension: compact([
            {
              url: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/ext-changeType',
              valueCode: member.changeType,
            },
            coverage
              ? {
                  url: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/ext-coverageReference',
                  valueReference: {
                    reference: `Coverage/${coverage.fhirId}`,
                  },
                }
              : null,
            role
              ? {
                  url: 'http://hl7.org/fhir/us/davinci-atr/StructureDefinition/ext-attributedProvider',
                  valueReference: {
                    reference: `PractitionerRole/${role.fhirId}`,
                  },
                }
              : null,
          ]),
          entity: this.toPatientReference(member.patientSourceId),
          period: {
            start: member.attributionStart,
            end: member.attributionEnd,
          },
          inactive: member.inactive,
        };
      }),
    };
  }
}
