/**
 * Declarative FHIR search parameter registry.
 *
 * Maps (resourceType, paramName) to a descriptor that drives SQL generation.
 * Avoids JSONB `@>` containment operator (not supported through Hyperdrive).
 */

export type SearchParamType =
  | "reference"
  | "token"
  | "token-coded"
  | "date"
  | "string-name"
  | "category";

export type SearchParamDef = {
  type: SearchParamType;
  /** Top-level JSONB key, e.g. "subject", "status", "code" */
  jsonbKey: string;
  /** For nested paths: second-level key, e.g. "reference" under "subject" */
  jsonbSubKey?: string;
  /** If true the top-level key holds an array (needs jsonb_array_elements) */
  isArray?: boolean;
  /** For token-coded: the sub-path to the coding array, e.g. "coding" under "code" */
  codingPath?: string;
};

export type SearchParamRegistry = Record<
  string,
  Record<string, SearchParamDef>
>;

export const searchParamRegistry: SearchParamRegistry = {
  Patient: {
    name: {
      type: "string-name",
      jsonbKey: "name",
    },
    birthdate: {
      type: "date",
      jsonbKey: "birthDate",
    },
    gender: {
      type: "token",
      jsonbKey: "gender",
    },
    "general-practitioner": {
      type: "reference",
      jsonbKey: "generalPractitioner",
      jsonbSubKey: "reference",
      isArray: true,
    },
  },

  Encounter: {
    patient: {
      type: "reference",
      jsonbKey: "subject",
      jsonbSubKey: "reference",
    },
    date: {
      type: "date",
      jsonbKey: "period",
      jsonbSubKey: "start",
    },
    status: {
      type: "token",
      jsonbKey: "status",
    },
    type: {
      type: "token-coded",
      jsonbKey: "type",
      isArray: true,
      codingPath: "coding",
    },
    practitioner: {
      type: "reference",
      jsonbKey: "participant",
      jsonbSubKey: "individual",
      isArray: true,
    },
    location: {
      type: "reference",
      jsonbKey: "location",
      jsonbSubKey: "location",
      isArray: true,
    },
    "reason-code": {
      type: "token-coded",
      jsonbKey: "reasonCode",
      isArray: true,
      codingPath: "coding",
    },
  },

  Condition: {
    patient: {
      type: "reference",
      jsonbKey: "subject",
      jsonbSubKey: "reference",
    },
    code: {
      type: "token-coded",
      jsonbKey: "code",
      codingPath: "coding",
    },
    "clinical-status": {
      type: "token-coded",
      jsonbKey: "clinicalStatus",
      codingPath: "coding",
    },
    category: {
      type: "category",
      jsonbKey: "category",
    },
  },

  Procedure: {
    patient: {
      type: "reference",
      jsonbKey: "subject",
      jsonbSubKey: "reference",
    },
    code: {
      type: "token-coded",
      jsonbKey: "code",
      codingPath: "coding",
    },
  },

  Observation: {
    patient: {
      type: "reference",
      jsonbKey: "subject",
      jsonbSubKey: "reference",
    },
    code: {
      type: "token-coded",
      jsonbKey: "code",
      codingPath: "coding",
    },
    category: {
      type: "category",
      jsonbKey: "category",
    },
    date: {
      type: "date",
      jsonbKey: "effectiveDateTime",
    },
  },

  MedicationRequest: {
    patient: {
      type: "reference",
      jsonbKey: "subject",
      jsonbSubKey: "reference",
    },
    code: {
      type: "token-coded",
      jsonbKey: "medicationCodeableConcept",
      codingPath: "coding",
    },
    status: {
      type: "token",
      jsonbKey: "status",
    },
  },

  AllergyIntolerance: {
    patient: {
      type: "reference",
      jsonbKey: "patient",
      jsonbSubKey: "reference",
    },
  },
};

/** FHIR-internal params that are not search params */
const IGNORED_PARAMS = new Set(["_summary", "_count", "_format"]);

/**
 * Parse date prefix: "ge2025-01-01" → { op: ">=", value: "2025-01-01" }
 * If no prefix, defaults to "eq" → "=".
 */
export const parseDatePrefix = (
  raw: string,
): { op: string; value: string } => {
  const prefixes: Record<string, string> = {
    ge: ">=",
    le: "<=",
    gt: ">",
    lt: "<",
    eq: "=",
  };

  const candidate = raw.slice(0, 2);
  if (prefixes[candidate]) {
    return { op: prefixes[candidate], value: raw.slice(2) };
  }

  return { op: "=", value: raw };
};

/**
 * Filter out FHIR meta-params, returning only actual search params.
 */
export const extractSearchParams = (
  query: Record<string, string | string[]>,
): Record<string, string | string[]> => {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!IGNORED_PARAMS.has(key)) {
      result[key] = value;
    }
  }
  return result;
};

/**
 * In-memory filter: returns true if a resource matches all provided search params.
 * Used by the Supabase REST fallback adapter.
 */
export const resourceMatchesParams = (
  resource: Record<string, unknown>,
  resourceType: string,
  params: Record<string, string | string[]>,
): boolean => {
  const defs = searchParamRegistry[resourceType];
  if (!defs) return true;

  for (const [paramName, rawValue] of Object.entries(params)) {
    const def = defs[paramName];
    if (!def) continue;

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (!matchesSingleParam(resource, def, value)) return false;
    }
  }

  return true;
};

const matchesSingleParam = (
  resource: Record<string, unknown>,
  def: SearchParamDef,
  value: string,
): boolean => {
  switch (def.type) {
    case "reference":
      return matchesReference(resource, def, value);
    case "token":
      return matchesToken(resource, def, value);
    case "token-coded":
      return matchesTokenCoded(resource, def, value);
    case "date":
      return matchesDate(resource, def, value);
    case "string-name":
      return matchesStringName(resource, value);
    case "category":
      return matchesCategory(resource, def, value);
    default:
      return true;
  }
};

const matchesReference = (
  resource: Record<string, unknown>,
  def: SearchParamDef,
  value: string,
): boolean => {
  const topLevel = resource[def.jsonbKey];
  if (def.isArray && Array.isArray(topLevel)) {
    return topLevel.some((item) => {
      if (def.jsonbSubKey === "reference") {
        return getNestedString(item, "reference") === value;
      }
      const nested = getNestedValue(item, def.jsonbSubKey ?? "");
      return getNestedString(nested, "reference") === value;
    });
  }
  if (def.jsonbSubKey) {
    return getNestedString(topLevel, def.jsonbSubKey) === value;
  }
  return false;
};

const matchesToken = (
  resource: Record<string, unknown>,
  def: SearchParamDef,
  value: string,
): boolean => {
  return String(resource[def.jsonbKey] ?? "") === value;
};

const matchesTokenCoded = (
  resource: Record<string, unknown>,
  def: SearchParamDef,
  value: string,
): boolean => {
  const [system, code] = value.includes("|") ? value.split("|", 2) : ["", value];
  const topLevel = resource[def.jsonbKey];

  const searchInCoding = (obj: unknown): boolean => {
    if (!obj || typeof obj !== "object") return false;
    const coding = (obj as Record<string, unknown>)[def.codingPath ?? "coding"];
    if (!Array.isArray(coding)) return false;
    return coding.some((c: Record<string, unknown>) => {
      if (system && code) return c.system === system && String(c.code ?? "").startsWith(code);
      return String(c.code ?? "").startsWith(code);
    });
  };

  if (def.isArray && Array.isArray(topLevel)) {
    return topLevel.some(searchInCoding);
  }

  return searchInCoding(topLevel);
};

const matchesDate = (
  resource: Record<string, unknown>,
  def: SearchParamDef,
  value: string,
): boolean => {
  const { op, value: dateValue } = parseDatePrefix(value);
  let actual: string;

  if (def.jsonbSubKey) {
    const nested = resource[def.jsonbKey];
    actual = getNestedString(nested, def.jsonbSubKey);
  } else {
    actual = String(resource[def.jsonbKey] ?? "");
  }

  if (!actual) return false;
  const cmp = actual.localeCompare(dateValue);

  switch (op) {
    case ">=": return cmp >= 0;
    case "<=": return cmp <= 0;
    case ">": return cmp > 0;
    case "<": return cmp < 0;
    case "=": return actual.startsWith(dateValue);
    default: return true;
  }
};

const matchesStringName = (
  resource: Record<string, unknown>,
  value: string,
): boolean => {
  const names = resource.name;
  if (!Array.isArray(names)) return false;
  const lower = value.toLowerCase();

  return names.some((nameObj: Record<string, unknown>) => {
    const family = String(nameObj.family ?? "").toLowerCase();
    if (family.includes(lower)) return true;
    const given = nameObj.given;
    if (Array.isArray(given)) {
      return given.some((g: string) => String(g).toLowerCase().includes(lower));
    }
    return false;
  });
};

const matchesCategory = (
  resource: Record<string, unknown>,
  def: SearchParamDef,
  value: string,
): boolean => {
  const categories = resource[def.jsonbKey];
  if (!Array.isArray(categories)) return false;

  return categories.some((cat: Record<string, unknown>) => {
    const coding = cat.coding;
    if (Array.isArray(coding)) {
      return coding.some((c: Record<string, unknown>) => c.code === value);
    }
    return false;
  });
};

const getNestedString = (obj: unknown, key: string): string => {
  if (!obj || typeof obj !== "object") return "";
  return String((obj as Record<string, unknown>)[key] ?? "");
};

const getNestedValue = (obj: unknown, key: string): unknown => {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key];
};
