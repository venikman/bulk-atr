import type { FhirResource } from "./types.ts";

export interface FhirStore {
  getResource(resourceType: string, resourceId: string): Promise<FhirResource | null>;
  listByType(resourceType: string): Promise<FhirResource[]>;
  searchByParams(resourceType: string, params: Record<string, string | string[]>): Promise<FhirResource[]>;
  searchGroupsByIdentifier(identifier: string): Promise<FhirResource[]>;
  searchGroupsByName(name: string): Promise<FhirResource[]>;
  getGroupById(groupId: string): Promise<FhirResource | null>;
}
