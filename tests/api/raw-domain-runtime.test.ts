import { resolve } from 'node:path';
import atrFixture from '../../output/atr_bulk_export_single.json' with { type: 'json' };
import { AtrResolver } from '../../server/lib/atr-resolver.js';
import { loadRawDomainStore } from '../../server/lib/raw-domain-store.js';
import { supportedResourceTypes } from '../../server/lib/types.js';

const loadResolver = async () => {
  const store = await loadRawDomainStore({
    memberCoveragePath: resolve('input-services/member-coverage-service.json'),
    providerDirectoryPath: resolve('input-services/provider-directory-service.json'),
    claimsAttributionPath: resolve('input-services/claims-attribution-service.json'),
  });

  return {
    store,
    resolver: new AtrResolver(store),
  };
};

describe('raw-domain runtime', () => {
  test('indexes the single Group from raw source data', async () => {
    const { store, resolver } = await loadResolver();

    expect(store.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      resolver.findGroupsByIdentifier('http://example.org/contracts|CTR-2026-NWACO-001'),
    ).toHaveLength(1);
    expect(resolver.findGroupsByName('Northwind ACO 2026 Member Attribution List')).toHaveLength(1);

    const group = resolver.getGroupById('group-2026-northwind-atr-001');
    expect(group?.resourceType).toBe('Group');
    expect(group?.id).toBe('group-2026-northwind-atr-001');
    expect(group?.quantity).toBe(50);
  });

  test('builds a full export from raw source data that matches the checked-in FHIR artifact', async () => {
    const { resolver } = await loadResolver();

    const exportResources = resolver.buildExportResources(
      'group-2026-northwind-atr-001',
      supportedResourceTypes,
    );

    expect(exportResources).toEqual(atrFixture.resources);
  });

  test('keeps source hashing stable across loads and maps dependent coverage to RelatedPerson', async () => {
    const first = await loadResolver();
    const second = await loadResolver();

    expect(first.store.sourceHash).toBe(second.store.sourceHash);

    const coverage = first.resolver.getResource('Coverage', 'coverage-0003');
    expect(coverage).toMatchObject({
      resourceType: 'Coverage',
      policyHolder: { reference: 'RelatedPerson/relatedperson-0003' },
      subscriber: { reference: 'RelatedPerson/relatedperson-0003' },
      beneficiary: { reference: 'Patient/patient-0003' },
    });

    const patient = first.resolver.getResource('Patient', 'patient-0003');
    expect(patient).toMatchObject({
      resourceType: 'Patient',
      contact: [
        {
          relationship: [{ text: 'Parent or Guardian' }],
        },
      ],
    });
  });

  test('derives Group identifiers from contract and provider organization metadata only', async () => {
    const { resolver } = await loadResolver();

    const group = resolver.getGroupById('group-2026-northwind-atr-001');
    expect(group).toMatchObject({
      resourceType: 'Group',
      identifier: [
        {
          system: 'http://example.org/contracts',
          value: 'CTR-2026-NWACO-001',
        },
        {
          system: 'http://hl7.org/fhir/sid/us-npi',
          value: '1992000001',
        },
        {
          system: 'urn:oid:2.16.840.1.113883.4.4',
          value: '14-1111111',
        },
        {
          system: 'http://example.org/settlement-entities',
          value: 'NWACO-001',
        },
      ],
    });

    const exportResources = resolver.buildExportResources(
      'group-2026-northwind-atr-001',
      supportedResourceTypes,
    );
    expect(exportResources?.Location).toHaveLength(5);
    expect(exportResources).not.toHaveProperty('Claim');
  });
});
