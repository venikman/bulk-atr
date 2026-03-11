import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  FhirResource,
  JsonObject,
  ResourceCollection,
  SupportedResourceType,
} from './types.js';
import { supportedResourceTypes } from './types.js';

const referencePattern = /^([A-Za-z]+)\/([^/]+)$/;

const isFhirResource = (value: unknown): value is FhirResource =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as FhirResource).resourceType === 'string' &&
  typeof (value as FhirResource).id === 'string';

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

export class ProjectionStore {
  readonly data: ResourceCollection;

  readonly byKey = new Map<string, FhirResource>();

  readonly groupIdentifierIndex = new Map<string, FhirResource[]>();

  readonly groupNameIndex = new Map<string, FhirResource[]>();

  constructor(data: ResourceCollection) {
    this.data = data;

    for (const resourceType of supportedResourceTypes) {
      for (const resource of data[resourceType]) {
        this.byKey.set(`${resourceType}/${resource.id}`, resource);
      }
    }

    for (const group of data.Group) {
      const identifiers = Array.isArray(group.identifier) ? group.identifier : [];
      for (const identifier of identifiers) {
        if (
          identifier &&
          typeof identifier === 'object' &&
          typeof identifier.system === 'string' &&
          typeof identifier.value === 'string'
        ) {
          const key = `${identifier.system}|${identifier.value}`;
          const current = this.groupIdentifierIndex.get(key) || [];
          current.push(group);
          this.groupIdentifierIndex.set(key, current);
        }
      }

      if (typeof group.name === 'string') {
        const lowered = group.name.toLowerCase();
        const current = this.groupNameIndex.get(lowered) || [];
        current.push(group);
        this.groupNameIndex.set(lowered, current);
      }
    }
  }

  static fromFixtureDocument(parsed: { resources: Record<string, unknown> }) {
    const collection = Object.fromEntries(
      supportedResourceTypes.map((type) => {
        const resources = parsed.resources?.[type];
        if (!Array.isArray(resources)) {
          throw new Error(`Fixture resources for ${type} are missing or invalid.`);
        }

        return [type, resources.filter(isFhirResource)];
      }),
    ) as ResourceCollection;

    return new ProjectionStore(collection);
  }

  static async load(fixturePath: string) {
    const absolute = resolve(fixturePath);
    const content = await readFile(absolute, 'utf-8');
    const parsed = JSON.parse(content) as { resources: Record<string, unknown> };

    return ProjectionStore.fromFixtureDocument(parsed);
  }

  getGroupById(id: string) {
    const group = this.byKey.get(`Group/${id}`);
    return group?.resourceType === 'Group' ? group : null;
  }

  findGroupsByIdentifier(identifier: string) {
    return this.groupIdentifierIndex.get(identifier) || [];
  }

  findGroupsByName(name: string) {
    const lowered = name.toLowerCase();
    const exact = this.groupNameIndex.get(lowered);
    if (exact) {
      return exact;
    }

    const matches: FhirResource[] = [];
    for (const [candidate, groups] of this.groupNameIndex.entries()) {
      if (candidate.includes(lowered)) {
        matches.push(...groups);
      }
    }
    return matches;
  }

  getResource(resourceType: string, id: string) {
    return this.byKey.get(`${resourceType}/${id}`) || null;
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
    const queue: FhirResource[] = [];

    const addResource = (resource: FhirResource | null) => {
      if (!resource) {
        return;
      }
      if (!requested.has(resource.resourceType as SupportedResourceType)) {
        return;
      }

      const key = `${resource.resourceType}/${resource.id}`;
      if (selectedKeys.has(key)) {
        return;
      }

      selectedKeys.add(key);
      queue.push(resource);
    };

    addResource(group);

    while (queue.length > 0) {
      const resource = queue.shift();
      if (!resource) {
        continue;
      }

      const references = new Set<string>();
      collectReferences(resource, references);

      for (const reference of references) {
        const parsed = parseReference(reference);
        if (!parsed) {
          continue;
        }

        if (!requested.has(parsed.resourceType)) {
          continue;
        }

        addResource(this.getResource(parsed.resourceType, parsed.id));
      }
    }

    return Object.fromEntries(
      requestedTypes.map((type) => [
        type,
        this.data[type].filter((resource) => selectedKeys.has(`${type}/${resource.id}`)),
      ]),
    ) as Partial<ResourceCollection>;
  }
}
