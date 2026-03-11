import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ExportArtifactStore } from './export-artifact-store.js';
import type { FhirResource, StoredManifest } from './types.js';

export class FileStore implements ExportArtifactStore {
  readonly runtimeDir: string;

  readonly filesDir: string;

  readonly manifestsDir: string;

  constructor(runtimeDir: string) {
    this.runtimeDir = resolve(runtimeDir);
    this.filesDir = join(this.runtimeDir, 'files');
    this.manifestsDir = join(this.runtimeDir, 'manifests');
  }

  async init() {
    await mkdir(this.filesDir, { recursive: true });
    await mkdir(this.manifestsDir, { recursive: true });
  }

  async writeNdjson(jobId: string, fileName: string, resources: FhirResource[]) {
    const filePath = join(this.filesDir, jobId, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    const payload = resources.map((resource) => JSON.stringify(resource)).join('\n');
    await writeFile(filePath, payload + (payload ? '\n' : ''), 'utf-8');
    return filePath;
  }

  async writeManifest(jobId: string, manifest: StoredManifest) {
    const filePath = join(this.manifestsDir, `${jobId}.json`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    return filePath;
  }

  async readManifest(manifestKey: string) {
    const content = await readFile(manifestKey, 'utf-8');
    return JSON.parse(content) as StoredManifest;
  }

  async readNdjson(artifactKey: string) {
    return readFile(artifactKey, 'utf-8');
  }
}
