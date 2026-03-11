import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import {
  type AppEnv,
  type AuthMode,
  createAuthMiddleware,
  getCallerId,
  requiresAccessToken,
} from '../lib/auth.js';
import type { ExportJobStore } from '../lib/export-jobs.js';
import type { FileStore } from '../lib/file-store.js';
import { fhirOperationOutcome } from '../lib/operation-outcome.js';
import type { ProjectionStore } from '../lib/projection-store.js';
import { type SupportedResourceType, supportedResourceTypes } from '../lib/types.js';

const minimumResourceTypes: SupportedResourceType[] = ['Group', 'Patient', 'Coverage'];
const canonicalResourceTypeOrder = supportedResourceTypes;
const exportTypeValue = 'hl7.fhir.us.davinci-atr';
const unsupportedParameters = ['_since', '_until', '_typeFilter', 'patient'] as const;
type NormalizedTypeParameter =
  | {
      normalized: SupportedResourceType[];
    }
  | {
      error: string;
    }
  | null;

type BulkRoutesOptions = {
  projectionStore: ProjectionStore;
  jobStore: ExportJobStore;
  fileStore: FileStore;
  authMode: AuthMode;
  jobDelayMs?: number;
};

const normalizeTypeParameter = (value: string | undefined | null): NormalizedTypeParameter => {
  if (!value) {
    return null;
  }

  const values = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (values.length === 0) {
    return null;
  }

  const requested = new Set(values);
  const invalid = values.filter(
    (resourceType) => !canonicalResourceTypeOrder.includes(resourceType as SupportedResourceType),
  );

  if (invalid.length > 0) {
    return { error: `Unsupported _type resource(s): ${invalid.join(', ')}.` };
  }

  const normalized = canonicalResourceTypeOrder.filter((type) => requested.has(type));
  return { normalized };
};

const buildCanonicalRequestUrl = (
  requestUrl: string,
  normalizedTypes: SupportedResourceType[],
  exportType: string,
) => {
  const url = new URL(requestUrl);
  url.search = '';
  url.searchParams.set('exportType', exportType);
  url.searchParams.set('_type', normalizedTypes.join(','));
  return url.toString();
};

const buildManifest = (
  baseUrl: string,
  jobId: string,
  transactionTime: string,
  requestUrl: string,
  normalizedTypes: SupportedResourceType[],
  authMode: AuthMode,
) => ({
  transactionTime,
  request: requestUrl,
  requiresAccessToken: requiresAccessToken(authMode),
  output: normalizedTypes.map((type) => ({
    type,
    url: `${baseUrl}/fhir/bulk-files/${jobId}/${type}-1.ndjson`,
  })),
  error: [],
});

const scheduleExportJob = async (
  jobId: string,
  groupId: string,
  requestUrl: string,
  normalizedTypes: SupportedResourceType[],
  authMode: AuthMode,
  jobStore: ExportJobStore,
  fileStore: FileStore,
  projectionStore: ProjectionStore,
) => {
  const baseUrl = new URL(requestUrl).origin;
  const exportResources = projectionStore.buildExportResources(groupId, normalizedTypes);
  if (!exportResources) {
    await jobStore.markFailed(jobId, ['Group snapshot could not be resolved for export.']);
    return;
  }

  await jobStore.markRunning(jobId, 'writing ndjson files');

  const files = [];
  for (const type of normalizedTypes) {
    const resources = exportResources[type] || [];
    const fileName = `${type}-1.ndjson`;
    const path = await fileStore.writeNdjson(jobId, fileName, resources);
    files.push({
      type,
      fileName,
      path,
      url: `${baseUrl}/fhir/bulk-files/${jobId}/${fileName}`,
    });
  }

  const transactionTime = new Date().toISOString();
  const manifest = buildManifest(
    baseUrl,
    jobId,
    transactionTime,
    buildCanonicalRequestUrl(requestUrl, normalizedTypes, exportTypeValue),
    normalizedTypes,
    authMode,
  );
  const manifestPath = await fileStore.writeManifest(jobId, manifest);
  await jobStore.markCompleted(jobId, manifestPath, files);
};

export const createBulkRoutes = ({
  projectionStore,
  jobStore,
  fileStore,
  authMode,
  jobDelayMs = 50,
}: BulkRoutesOptions) => {
  const app = new Hono<AppEnv>();
  app.use('/Group/:id/$davinci-data-export', createAuthMiddleware(authMode));
  app.use('/bulk-status/:jobId', createAuthMiddleware(authMode));
  app.use('/bulk-files/:jobId/:fileName', createAuthMiddleware(authMode));

  app.get('/Group/:id/$davinci-data-export', async (context) => {
    const groupId = context.req.param('id');
    const group = projectionStore.getGroupById(groupId);
    if (!group) {
      return fhirOperationOutcome(context, 404, 'not-found', 'Group was not found.');
    }

    const exportType = context.req.query('exportType');
    if (exportType !== exportTypeValue) {
      return fhirOperationOutcome(
        context,
        400,
        'invalid',
        `exportType must equal ${exportTypeValue}.`,
      );
    }

    for (const parameter of unsupportedParameters) {
      if (context.req.query(parameter)) {
        return fhirOperationOutcome(
          context,
          400,
          'not-supported',
          `${parameter} is not supported in phase 1.`,
        );
      }
    }

    const normalizedFromType = normalizeTypeParameter(context.req.query('_type'));
    const normalizedFromAlias = normalizeTypeParameter(context.req.query('resourceTypes'));

    if (normalizedFromType && 'error' in normalizedFromType) {
      return fhirOperationOutcome(context, 400, 'invalid', normalizedFromType.error);
    }
    if (normalizedFromAlias && 'error' in normalizedFromAlias) {
      return fhirOperationOutcome(context, 400, 'invalid', normalizedFromAlias.error);
    }

    const normalizedTypes =
      normalizedFromType?.normalized || normalizedFromAlias?.normalized || null;

    if (!normalizedTypes) {
      return fhirOperationOutcome(
        context,
        400,
        'invalid',
        '_type is required and must include at least Group,Patient,Coverage.',
      );
    }

    if (
      normalizedFromType?.normalized &&
      normalizedFromAlias?.normalized &&
      normalizedFromType.normalized.join(',') !== normalizedFromAlias.normalized.join(',')
    ) {
      return fhirOperationOutcome(
        context,
        400,
        'invalid',
        'resourceTypes alias must match the canonical _type parameter when both are provided.',
      );
    }

    const missingMinimumTypes = minimumResourceTypes.filter(
      (type) => !normalizedTypes.includes(type),
    );
    if (missingMinimumTypes.length > 0) {
      return fhirOperationOutcome(
        context,
        400,
        'invalid',
        `Missing required _type values: ${missingMinimumTypes.join(', ')}.`,
      );
    }

    const transactionTime = new Date().toISOString();
    const jobId = randomUUID();
    await jobStore.createJob({
      jobId,
      groupId,
      transactionTime,
      requestUrl: buildCanonicalRequestUrl(context.req.url, normalizedTypes, exportTypeValue),
      normalizedTypes,
      exportType: exportTypeValue,
    });

    setTimeout(() => {
      void scheduleExportJob(
        jobId,
        groupId,
        context.req.url,
        normalizedTypes,
        authMode,
        jobStore,
        fileStore,
        projectionStore,
      ).catch(async (error: unknown) => {
        const diagnostics =
          error instanceof Error ? error.message : 'Unexpected export generation failure.';
        await jobStore.markFailed(jobId, [diagnostics]);
      });
    }, jobDelayMs);

    const contentLocation = `${new URL(context.req.url).origin}/fhir/bulk-status/${jobId}`;
    context.header('content-location', contentLocation);
    context.header('retry-after', '1');
    return context.body(null, 202);
  });

  app.get('/bulk-status/:jobId', async (context) => {
    const auth = context.get('auth');
    const callerId = getCallerId(auth);
    const jobId = context.req.param('jobId');
    const job = await jobStore.getJob(jobId);

    if (!job || job.status === 'expired') {
      return fhirOperationOutcome(context, 404, 'not-found', 'Bulk export job was not found.');
    }

    if (!jobStore.canPoll(jobId, callerId)) {
      context.header('retry-after', '1');
      return fhirOperationOutcome(
        context,
        429,
        'throttled',
        'Polling too frequently. Retry after one second.',
      );
    }

    if (job.status === 'accepted' || job.status === 'running') {
      context.header('x-progress', job.progress);
      context.header('retry-after', '1');
      return context.body(null, 202);
    }

    if (job.status === 'failed') {
      return fhirOperationOutcome(
        context,
        500,
        'exception',
        job.error.join(' ') || 'Bulk export job failed.',
      );
    }

    if (!job.manifestPath) {
      return fhirOperationOutcome(
        context,
        500,
        'exception',
        'Bulk export job completed without a manifest path.',
      );
    }

    const manifest = await fileStore.readManifest(job.manifestPath);
    context.header('expires', job.expiresAt);
    context.header('content-type', 'application/json; charset=utf-8');
    return context.json(manifest);
  });

  app.get('/bulk-files/:jobId/:fileName', async (context) => {
    const jobId = context.req.param('jobId');
    const fileName = context.req.param('fileName');
    const job = await jobStore.getJob(jobId);

    if (!job || job.status === 'expired') {
      return fhirOperationOutcome(context, 404, 'not-found', 'Bulk export job was not found.');
    }

    const file = job.files.find((entry) => entry.fileName === fileName);
    if (!file) {
      return fhirOperationOutcome(context, 404, 'not-found', 'Bulk export file was not found.');
    }

    try {
      const content = await fileStore.readNdjson(jobId, fileName);
      context.header('content-type', 'application/fhir+ndjson; charset=utf-8');
      return context.body(content, 200);
    } catch {
      return fhirOperationOutcome(context, 404, 'not-found', 'Bulk export file was not found.');
    }
  });

  return app;
};
