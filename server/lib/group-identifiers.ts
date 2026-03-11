import type { RawAttributionList, RawOrganization } from './raw-domain-types.js';

export type GroupIdentifierToken = {
  system: string;
  value: string;
};

export const getGroupIdentifierTokens = (
  raw: RawAttributionList,
  providerOrganization?: RawOrganization | null,
): GroupIdentifierToken[] => {
  const identifiers: GroupIdentifierToken[] = [
    {
      system: 'http://example.org/contracts',
      value: raw.contractId,
    },
  ];

  if (providerOrganization?.npi) {
    identifiers.push({
      system: 'http://hl7.org/fhir/sid/us-npi',
      value: providerOrganization.npi,
    });
  }

  if (providerOrganization?.tin) {
    identifiers.push({
      system: 'urn:oid:2.16.840.1.113883.4.4',
      value: providerOrganization.tin,
    });
  }

  identifiers.push({
    system: 'http://example.org/settlement-entities',
    value: raw.settlementEntityId,
  });

  return identifiers;
};
