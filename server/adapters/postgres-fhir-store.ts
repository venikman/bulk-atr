import type { FhirStore } from "../lib/fhir-store.ts";
import type { FhirResource } from "../lib/types.ts";
import type { SqlQueryable } from "../lib/sql-client.ts";
import {
  searchParamRegistry,
  parseDatePrefix,
  type SearchParamDef,
} from "../lib/search-params.ts";

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

  async searchByParams(resourceType: string, params: Record<string, string | string[]>) {
    const defs = searchParamRegistry[resourceType];
    if (!defs) return this.listByType(resourceType);

    const clauses: string[] = [];
    const values: unknown[] = [resourceType];
    let paramIndex = 2;

    for (const [paramName, rawValue] of Object.entries(params)) {
      const def = defs[paramName];
      if (!def) continue;

      const paramValues = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of paramValues) {
        const result = this.buildWhereClause(def, paramName, value, paramIndex);
        if (result) {
          clauses.push(result.clause);
          values.push(...result.values);
          paramIndex += result.values.length;
        }
      }
    }

    const whereExtra = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
    const sql = `SELECT resource_json FROM fhir_resources WHERE resource_type = $1${whereExtra} ORDER BY resource_id`;
    const result = await this.queryable.query<ResourceRow>(sql, values);
    return result.rows.map(parseResourceJson);
  }

  private buildWhereClause(
    def: SearchParamDef,
    _paramName: string,
    value: string,
    startIndex: number,
  ): { clause: string; values: unknown[] } | null {
    switch (def.type) {
      case "reference":
        return this.buildReferenceClause(def, value, startIndex);
      case "token":
        return this.buildTokenClause(def, value, startIndex);
      case "token-coded":
        return this.buildTokenCodedClause(def, value, startIndex);
      case "date":
        return this.buildDateClause(def, value, startIndex);
      case "string-name":
        return this.buildStringNameClause(value, startIndex);
      case "category":
        return this.buildCategoryClause(def, value, startIndex);
      default:
        return null;
    }
  }

  private buildReferenceClause(
    def: SearchParamDef,
    value: string,
    idx: number,
  ): { clause: string; values: unknown[] } {
    if (def.isArray) {
      // Array of objects — use jsonb_array_elements + scalar comparison
      // e.g. participant[].individual.reference or generalPractitioner[].reference
      const nestedRef = def.jsonbSubKey === "reference"
        ? `e->>'reference'`
        : `e->'${def.jsonbSubKey}'->>'reference'`;
      return {
        clause: `EXISTS (SELECT 1 FROM jsonb_array_elements(resource_json->'${def.jsonbKey}') AS e WHERE ${nestedRef} = $${idx})`,
        values: [value],
      };
    }
    // Scalar object — e.g. subject.reference
    return {
      clause: `resource_json->'${def.jsonbKey}'->>'${def.jsonbSubKey}' = $${idx}`,
      values: [value],
    };
  }

  private buildTokenClause(
    def: SearchParamDef,
    value: string,
    idx: number,
  ): { clause: string; values: unknown[] } {
    return {
      clause: `resource_json->>'${def.jsonbKey}' = $${idx}`,
      values: [value],
    };
  }

  private buildTokenCodedClause(
    def: SearchParamDef,
    value: string,
    idx: number,
  ): { clause: string; values: unknown[] } {
    const [system, code] = value.includes("|") ? value.split("|", 2) : ["", value];
    const codingPath = def.codingPath ?? "coding";

    if (def.isArray) {
      // Array of CodeableConcept — e.g. type[].coding[] or reasonCode[].coding[]
      if (system && code) {
        return {
          clause: `EXISTS (SELECT 1 FROM jsonb_array_elements(resource_json->'${def.jsonbKey}') AS outer_e, jsonb_array_elements(outer_e->'${codingPath}') AS c WHERE c->>'system' = $${idx} AND c->>'code' LIKE $${idx + 1})`,
          values: [system, `${code}%`],
        };
      }
      return {
        clause: `EXISTS (SELECT 1 FROM jsonb_array_elements(resource_json->'${def.jsonbKey}') AS outer_e, jsonb_array_elements(outer_e->'${codingPath}') AS c WHERE c->>'code' LIKE $${idx})`,
        values: [`${code}%`],
      };
    }

    // Single CodeableConcept — e.g. code.coding[]
    if (system && code) {
      return {
        clause: `EXISTS (SELECT 1 FROM jsonb_array_elements(resource_json->'${def.jsonbKey}'->'${codingPath}') AS c WHERE c->>'system' = $${idx} AND c->>'code' LIKE $${idx + 1})`,
        values: [system, `${code}%`],
      };
    }
    return {
      clause: `EXISTS (SELECT 1 FROM jsonb_array_elements(resource_json->'${def.jsonbKey}'->'${codingPath}') AS c WHERE c->>'code' LIKE $${idx})`,
      values: [`${code}%`],
    };
  }

  private buildDateClause(
    def: SearchParamDef,
    value: string,
    idx: number,
  ): { clause: string; values: unknown[] } {
    const { op, value: dateValue } = parseDatePrefix(value);

    const jsonbPath = def.jsonbSubKey
      ? `resource_json->'${def.jsonbKey}'->>'${def.jsonbSubKey}'`
      : `resource_json->>'${def.jsonbKey}'`;

    return {
      clause: `${jsonbPath} ${op} $${idx}`,
      values: [dateValue],
    };
  }

  private buildStringNameClause(
    value: string,
    idx: number,
  ): { clause: string; values: unknown[] } {
    // Search across name[].family and name[].given[]
    return {
      clause: `EXISTS (
        SELECT 1 FROM jsonb_array_elements(resource_json->'name') AS n
        WHERE lower(n->>'family') LIKE $${idx}
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(n->'given') AS g WHERE lower(g) LIKE $${idx})
      )`,
      values: [`%${value.toLowerCase()}%`],
    };
  }

  private buildCategoryClause(
    def: SearchParamDef,
    value: string,
    idx: number,
  ): { clause: string; values: unknown[] } {
    return {
      clause: `EXISTS (SELECT 1 FROM jsonb_array_elements(resource_json->'${def.jsonbKey}') AS cat, jsonb_array_elements(cat->'coding') AS c WHERE c->>'code' = $${idx})`,
      values: [value],
    };
  }

  async searchGroupsByIdentifier(identifier: string) {
    const [system, value] = identifier.split("|", 2);
    if (!system || !value) return [];
    const result = await this.queryable.query<ResourceRow>(
      `SELECT resource_json FROM fhir_resources
       WHERE resource_type = 'Group'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(resource_json->'identifier') AS ident
         WHERE ident->>'system' = $1 AND ident->>'value' = $2
       )`,
      [system, value],
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
