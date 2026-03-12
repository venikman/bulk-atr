export type JsonObject = Record<string, unknown>;

export type FhirResource = JsonObject & {
  resourceType: string;
  id: string;
};

export type SupportedResourceType =
  | "Group"
  | "Patient"
  | "Coverage"
  | "RelatedPerson"
  | "Practitioner"
  | "PractitionerRole"
  | "Organization"
  | "Location";

export const supportedResourceTypes: SupportedResourceType[] = [
  "Group",
  "Patient",
  "Coverage",
  "RelatedPerson",
  "Practitioner",
  "PractitionerRole",
  "Organization",
  "Location",
];

export type ResourceCollection = Record<SupportedResourceType, FhirResource[]>;

export type BulkStatus =
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type ExportFileRecord = {
  type: SupportedResourceType;
  fileName: string;
  artifactKey: string;
};

export type StoredManifestOutputRecord = {
  type: SupportedResourceType;
  fileName: string;
};

export type StoredManifest = {
  transactionTime: string;
  request: string;
  requiresAccessToken: boolean;
  output: StoredManifestOutputRecord[];
  error: string[];
};

export type ExportJobRecord = {
  jobId: string;
  groupId: string;
  status: BulkStatus;
  transactionTime: string;
  requestUrl: string;
  normalizedTypes: SupportedResourceType[];
  exportType: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  progress: string;
  manifestKey: string | null;
  files: ExportFileRecord[];
  error: string[];
};
