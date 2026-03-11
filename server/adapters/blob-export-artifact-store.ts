import { get, put } from '@vercel/blob';
import type { ExportArtifactStore } from '../lib/export-artifact-store.js';
import type { FhirResource, StoredManifest } from '../lib/types.js';

type BlobPutOptions = {
  contentType: string;
};

type BlobArtifactClient = {
  put(key: string, body: string, options: BlobPutOptions): Promise<{ pathname: string }>;
  read(key: string): Promise<{ body: string } | null>;
};

type BlobExportArtifactStoreOptions = {
  client?: BlobArtifactClient;
  prefix?: string;
};

const normalizePrefix = (prefix: string) => prefix.replace(/^\/+|\/+$/g, '');

const toText = async (stream: ReadableStream<Uint8Array>) => {
  const response = new Response(stream);
  return response.text();
};

export const createVercelBlobArtifactClient = (): BlobArtifactClient => ({
  async put(key, body, options) {
    const result = await put(key, body, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: options.contentType,
    });

    return { pathname: result.pathname };
  },
  async read(key) {
    const result = await get(key, {
      access: 'private',
      useCache: false,
    });

    if (!result || result.statusCode !== 200 || !result.stream) {
      return null;
    }

    return {
      body: await toText(result.stream),
    };
  },
});

export class BlobExportArtifactStore implements ExportArtifactStore {
  readonly client: BlobArtifactClient;

  readonly prefix: string;

  constructor({
    client = createVercelBlobArtifactClient(),
    prefix = 'bulk-atr',
  }: BlobExportArtifactStoreOptions = {}) {
    this.client = client;
    this.prefix = normalizePrefix(prefix);
  }

  private buildManifestKey(jobId: string) {
    return `${this.prefix}/manifests/${jobId}.json`;
  }

  private buildFileKey(jobId: string, fileName: string) {
    return `${this.prefix}/files/${jobId}/${fileName}`;
  }

  async writeManifest(jobId: string, manifest: StoredManifest) {
    const key = this.buildManifestKey(jobId);
    const result = await this.client.put(key, `${JSON.stringify(manifest, null, 2)}\n`, {
      contentType: 'application/json; charset=utf-8',
    });
    return result.pathname;
  }

  async writeNdjson(jobId: string, fileName: string, resources: FhirResource[]) {
    const key = this.buildFileKey(jobId, fileName);
    const payload = resources.map((resource) => JSON.stringify(resource)).join('\n');
    const result = await this.client.put(key, payload + (payload ? '\n' : ''), {
      contentType: 'application/fhir+ndjson; charset=utf-8',
    });
    return result.pathname;
  }

  async readManifest(manifestKey: string) {
    const object = await this.client.read(manifestKey);
    if (!object) {
      throw new Error('Blob object was not found.');
    }

    return JSON.parse(object.body) as StoredManifest;
  }

  async readNdjson(artifactKey: string) {
    const object = await this.client.read(artifactKey);
    if (!object) {
      throw new Error('Blob object was not found.');
    }

    return object.body;
  }
}
