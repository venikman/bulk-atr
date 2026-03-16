import type { FhirStore } from "./fhir-store.ts";
import type {
  FhirResource,
  JsonObject,
  ResourceCollection,
  SupportedResourceType,
} from "./types.ts";

const referencePattern = /^([A-Za-z]+)\/([^/]+)$/;

const collectReferences = (value: unknown, refs: Set<string>) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferences(item, refs);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (
      key === "reference" && typeof nested === "string" &&
      referencePattern.test(nested)
    ) {
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
  readonly store: FhirStore;

  constructor(store: FhirStore) {
    this.store = store;
  }

  getGroupById(id: string) {
    return this.store.getGroupById(id);
  }

  findGroupsByIdentifier(identifier: string) {
    return this.store.searchGroupsByIdentifier(identifier);
  }

  findGroupsByName(name: string) {
    return this.store.searchGroupsByName(name);
  }

  getResource(resourceType: string, id: string) {
    return this.store.getResource(resourceType, id);
  }

  listByType(resourceType: string) {
    return this.store.listByType(resourceType);
  }

  searchByParams(resourceType: string, params: Record<string, string | string[]>) {
    return this.store.searchByParams(resourceType, params);
  }

  buildSearchBundle(resources: FhirResource[], requestUrl: string) {
    return {
      resourceType: "Bundle",
      type: "searchset",
      total: resources.length,
      link: [
        {
          relation: "self",
          url: requestUrl,
        },
      ],
      entry: resources.map((resource) => ({
        fullUrl: `${
          new URL(requestUrl).origin
        }/fhir/${resource.resourceType}/${resource.id}`,
        resource,
      })),
    } satisfies JsonObject;
  }

  async buildExportResources(
    groupId: string,
    requestedTypes: SupportedResourceType[],
  ) {
    const group = await this.getGroupById(groupId);
    if (!group) {
      return null;
    }

    // Batch-load all resources of each requested type into an in-memory index.
    // This avoids hundreds of individual REST calls during BFS traversal.
    const resourceIndex = new Map<string, FhirResource>();
    resourceIndex.set(`Group/${group.id}`, group);

    for (const type of requestedTypes) {
      if (type === "Group") continue;
      const resources = await this.store.listByType(type);
      for (const resource of resources) {
        resourceIndex.set(`${resource.resourceType}/${resource.id}`, resource);
      }
    }

    // BFS through references using the in-memory index
    const requested = new Set(requestedTypes);
    const visitedKeys = new Set<string>([`Group/${group.id}`]);
    const queue: FhirResource[] = [group];
    let queueIndex = 0;
    const selectedResources = new Map<
      SupportedResourceType,
      Map<string, FhirResource>
    >();

    for (const type of requestedTypes) {
      selectedResources.set(type, new Map());
    }

    while (queueIndex < queue.length) {
      const resource = queue[queueIndex++];
      const key = `${resource.resourceType}/${resource.id}`;
      const resourceType = resource.resourceType as SupportedResourceType;
      if (requested.has(resourceType)) {
        selectedResources.get(resourceType)?.set(key, resource);
      }

      const references = new Set<string>();
      collectReferences(resource, references);

      for (const reference of references) {
        if (visitedKeys.has(reference)) continue;

        const parsed = parseReference(reference);
        if (!parsed) continue;

        const referenced = resourceIndex.get(reference);
        if (!referenced) continue;

        visitedKeys.add(reference);
        queue.push(referenced);
      }
    }

    return Object.fromEntries(
      requestedTypes.map((type) => {
        const resources = Array.from(
          selectedResources.get(type)?.values() || [],
        );
        return [type, resources];
      }),
    ) as Partial<ResourceCollection>;
  }
}
