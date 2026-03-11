import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { FhirResource } from './types.js';

export class FileStore {
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

  async writeManifest(jobId: string, manifest: Record<string, unknown>) {
    const filePath = join(this.manifestsDir, `${jobId}.json`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    return filePath;
  }

  async readManifest(manifestPath: string) {
    const content = await readFile(manifestPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  }

  async readNdjson(jobId: string, fileName: string) {
    const filePath = join(this.filesDir, jobId, fileName);
    return readFile(filePath, 'utf-8');
  }
}
