import type { FhirResource, StoredManifest } from "./types.ts";

export interface ExportArtifactStore {
  writeNdjson(
    jobId: string,
    fileName: string,
    resources: FhirResource[],
  ): Promise<string>;
  writeManifest(jobId: string, manifest: StoredManifest): Promise<string>;
  readManifest(manifestKey: string): Promise<StoredManifest>;
  readNdjson(artifactKey: string): Promise<string>;
}
