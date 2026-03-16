import type { FhirStore } from "../lib/fhir-store.ts";
import type { FhirResource } from "../lib/types.ts";
import { resourceMatchesParams } from "../lib/search-params.ts";

export class SupabaseRestFhirStore implements FhirStore {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.baseUrl = `${supabaseUrl}/rest/v1/fhir_resources`;
    this.headers = {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    };
  }

  private async query(params: string): Promise<FhirResource[]> {
    const response = await fetch(`${this.baseUrl}?${params}`, {
      headers: this.headers,
    });
    if (!response.ok) {
      throw new Error(`Supabase REST error ${response.status}: ${await response.text()}`);
    }
    const rows = await response.json() as Array<{ resource_json: FhirResource }>;
    return rows.map((row) => row.resource_json);
  }

  async getResource(resourceType: string, resourceId: string) {
    const resources = await this.query(
      `resource_type=eq.${encodeURIComponent(resourceType)}&resource_id=eq.${encodeURIComponent(resourceId)}&select=resource_json`,
    );
    return resources[0] ?? null;
  }

  async listByType(resourceType: string) {
    return this.query(
      `resource_type=eq.${encodeURIComponent(resourceType)}&select=resource_json&order=resource_id`,
    );
  }

  async searchByParams(resourceType: string, params: Record<string, string | string[]>) {
    const all = await this.listByType(resourceType);
    return all.filter((r) => resourceMatchesParams(r as Record<string, unknown>, resourceType, params));
  }

  async searchGroupsByIdentifier(identifier: string) {
    const [system, value] = identifier.split("|", 2);
    if (!system || !value) return [];
    const containment = JSON.stringify({ identifier: [{ system, value }] });
    return this.query(
      `resource_type=eq.Group&resource_json=cs.${encodeURIComponent(containment)}&select=resource_json`,
    );
  }

  async searchGroupsByName(name: string) {
    return this.query(
      `resource_type=eq.Group&resource_json->>name=ilike.*${encodeURIComponent(name)}*&select=resource_json`,
    );
  }

  async getGroupById(groupId: string) {
    return this.getResource("Group", groupId);
  }
}
