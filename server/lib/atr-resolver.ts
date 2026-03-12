import { AtrMapper } from './atr-mapper.js';
import type { RawDomainStore } from './raw-domain-store.js';
import type {
  FhirResource,
  JsonObject,
  ResourceCollection,
  SupportedResourceType,
} from './types.js';

const referencePattern = /^([A-Za-z]+)\/([^/]+)$/;

const collectReferences = (value: unknown, refs: Set<string>) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferences(item, refs);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'reference' && typeof nested === 'string' && referencePattern.test(nested)) {
      refs.add(nested);
      continue;
    }

    collectReferences(nested, refs);
  }
};

const parseReference = (reference: string) => {
  const match = referencePattern.exec(reference);
  if (!match) {
    return null;
  }

  return { resourceType: match[1] as SupportedResourceType, id: match[2] };
};

export class AtrResolver {
  readonly store: RawDomainStore;

  readonly mapper: AtrMapper;

  readonly cache = new Map<string, FhirResource>();

  constructor(store: RawDomainStore) {
    this.store = store;
    this.mapper = new AtrMapper(store);
  }

  private mapCached(key: string, builder: () => FhirResource | null) {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const resource = builder();
    if (resource) {
      this.cache.set(key, resource);
    }
    return resource;
  }

  getGroupById(id: string) {
    return this.mapCached(`Group/${id}`, () => {
      const raw = this.store.indexes.attributionListsByGroupId.get(id);
      return raw ? this.mapper.mapGroup(raw) : null;
    });
  }

  findGroupsByIdentifier(identifier: string) {
    return (this.store.indexes.attributionListsByIdentifier.get(identifier) || []).map((raw) =>
      this.getGroupById(raw.fhirId),
    ) as FhirResource[];
  }

  findGroupsByName(name: string) {
    const lowered = name.toLowerCase();
    const exact = this.store.indexes.attributionListsByName.get(lowered);
    if (exact) {
      return exact.map((raw) => this.getGroupById(raw.fhirId)) as FhirResource[];
    }

    const matches: FhirResource[] = [];
    for (const [candidate, groups] of this.store.indexes.attributionListsByName.entries()) {
      if (candidate.includes(lowered)) {
        matches.push(...(groups.map((raw) => this.getGroupById(raw.fhirId)) as FhirResource[]));
      }
    }

    return matches;
  }

  getResource(resourceType: string, id: string) {
    return this.mapCached(`${resourceType}/${id}`, () => {
      switch (resourceType) {
        case 'Group': {
          const raw = this.store.indexes.attributionListsByGroupId.get(id);
          return raw ? this.mapper.mapGroup(raw) : null;
        }
        case 'Patient': {
          const raw = this.store.indexes.patientsByFhirId.get(id);
          return raw ? this.mapper.mapPatient(raw) : null;
        }
        case 'Coverage': {
          const raw = this.store.indexes.coveragesByFhirId.get(id);
          return raw ? this.mapper.mapCoverage(raw) : null;
        }
        case 'RelatedPerson': {
          const raw = this.store.indexes.relatedPersonsByFhirId.get(id);
          return raw ? this.mapper.mapRelatedPerson(raw) : null;
        }
        case 'Practitioner': {
          const raw = this.store.indexes.practitionersByFhirId.get(id);
          return raw ? this.mapper.mapPractitioner(raw) : null;
        }
        case 'PractitionerRole': {
          const raw = this.store.indexes.rolesByFhirId.get(id);
          return raw ? this.mapper.mapPractitionerRole(raw) : null;
        }
        case 'Organization': {
          const raw = this.store.indexes.orgsByFhirId.get(id);
          return raw ? this.mapper.mapOrganization(raw) : null;
        }
        case 'Location': {
          const raw = this.store.indexes.locationsByFhirId.get(id);
          return raw ? this.mapper.mapLocation(raw) : null;
        }
        default:
          return null;
      }
    });
  }

  private listResourceIds(resourceType: SupportedResourceType) {
    switch (resourceType) {
      case 'Group':
        return this.store.claimsAttribution.functions.listAttributionLists.items.map(
          (raw) => raw.fhirId,
        );
      case 'Patient':
        return this.store.memberCoverage.functions.listPatients.items.map((raw) => raw.fhirId);
      case 'Coverage':
        return this.store.memberCoverage.functions.listCoverages.items.map((raw) => raw.fhirId);
      case 'RelatedPerson':
        return this.store.memberCoverage.functions.listRelatedPersons.items.map(
          (raw) => raw.fhirId,
        );
      case 'Practitioner':
        return this.store.providerDirectory.functions.listPractitioners.items.map(
          (raw) => raw.fhirId,
        );
      case 'PractitionerRole':
        return this.store.providerDirectory.functions.listPractitionerRoles.items.map(
          (raw) => raw.fhirId,
        );
      case 'Organization':
        return this.store.providerDirectory.functions.listOrganizations.items.map(
          (raw) => raw.fhirId,
        );
      case 'Location':
        return this.store.providerDirectory.functions.listLocations.items.map((raw) => raw.fhirId);
    }
  }

  buildSearchBundle(resources: FhirResource[], requestUrl: string) {
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: resources.length,
      link: [
        {
          relation: 'self',
          url: requestUrl,
        },
      ],
      entry: resources.map((resource) => ({
        fullUrl: `${new URL(requestUrl).origin}/fhir/${resource.resourceType}/${resource.id}`,
        resource,
      })),
    } satisfies JsonObject;
  }

  buildExportResources(groupId: string, requestedTypes: SupportedResourceType[]) {
    const group = this.getGroupById(groupId);
    if (!group) {
      return null;
    }

    const requested = new Set(requestedTypes);
    const selectedKeys = new Set<string>();
    const visitedKeys = new Set<string>([`Group/${group.id}`]);
    const queue: FhirResource[] = [group];

    while (queue.length > 0) {
      const resource = queue.shift();
      if (!resource) {
        continue;
      }

      const key = `${resource.resourceType}/${resource.id}`;
      if (requested.has(resource.resourceType as SupportedResourceType)) {
        selectedKeys.add(key);
      }

      const references = new Set<string>();
      collectReferences(resource, references);

      for (const reference of references) {
        const parsed = parseReference(reference);
        if (!parsed) {
          continue;
        }

        const referenced = this.getResource(parsed.resourceType, parsed.id);
        if (!referenced) {
          continue;
        }

        const referencedKey = `${referenced.resourceType}/${referenced.id}`;
        if (visitedKeys.has(referencedKey)) {
          continue;
        }

        visitedKeys.add(referencedKey);
        queue.push(referenced);
      }
    }

    return Object.fromEntries(
      requestedTypes.map((type) => {
        const resources: FhirResource[] = [];
        for (const id of this.listResourceIds(type)) {
          if (!selectedKeys.has(`${type}/${id}`)) {
            continue;
          }

          const resource = this.getResource(type, id);
          if (resource) {
            resources.push(resource);
          }
        }
        return [type, resources];
      }),
    ) as Partial<ResourceCollection>;
  }
}
