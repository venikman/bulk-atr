import type { FhirStore } from "../lib/fhir-store.ts";
import type { FhirResource } from "../lib/types.ts";
import type { SqlQueryable } from "../lib/sql-client.ts";

type ResourceRow = { resource_json: FhirResource | string };

const parseResourceJson = (row: ResourceRow): FhirResource =>
  typeof row.resource_json === "string"
    ? JSON.parse(row.resource_json) as FhirResource
    : row.resource_json;

export class PostgresFhirStore implements FhirStore {
  constructor(private readonly queryable: SqlQueryable) {}

  async getResource(resourceType: string, resourceId: string) {
    const result = await this.queryable.query<ResourceRow>(
      "SELECT resource_json FROM fhir_resources WHERE resource_type = $1 AND resource_id = $2",
      [resourceType, resourceId],
    );
    const row = result.rows[0];
    return row ? parseResourceJson(row) : null;
  }

  async listByType(resourceType: string) {
    const result = await this.queryable.query<ResourceRow>(
      "SELECT resource_json FROM fhir_resources WHERE resource_type = $1 ORDER BY resource_id",
      [resourceType],
    );
    return result.rows.map(parseResourceJson);
  }

  async searchGroupsByIdentifier(identifier: string) {
    const [system, value] = identifier.split("|", 2);
    if (!system || !value) return [];
    const result = await this.queryable.query<ResourceRow>(
      `SELECT resource_json FROM fhir_resources
       WHERE resource_type = 'Group'
       AND resource_json @> $1::jsonb`,
      [JSON.stringify({ identifier: [{ system, value }] })],
    );
    return result.rows.map(parseResourceJson);
  }

  async searchGroupsByName(name: string) {
    const result = await this.queryable.query<ResourceRow>(
      `SELECT resource_json FROM fhir_resources
       WHERE resource_type = 'Group'
       AND lower(resource_json->>'name') LIKE $1`,
      [`%${name.toLowerCase()}%`],
    );
    return result.rows.map(parseResourceJson);
  }

  async getGroupById(groupId: string) {
    return this.getResource("Group", groupId);
  }
}
