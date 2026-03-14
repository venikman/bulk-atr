import { Hono } from "hono";
import type { AtrResolver } from "../lib/atr-resolver.ts";
import {
  type AppEnv,
  type AuthMode,
  createAuthMiddleware,
  getCallerId,
  requiresAccessToken,
} from "../lib/auth.ts";
import type { ExportArtifactStore } from "../lib/export-artifact-store.ts";
import type {
  ClaimedExportJob,
  ExportJobRepository,
} from "../lib/export-job-repository.ts";
import { fhirOperationOutcome } from "../lib/operation-outcome.ts";
import {
  type StoredManifest,
  type SupportedResourceType,
  supportedResourceTypes,
} from "../lib/types.ts";

const minimumResourceTypes: SupportedResourceType[] = [
  "Group",
  "Patient",
  "Coverage",
];
const canonicalResourceTypeOrder = supportedResourceTypes;
const exportTypeValue = "hl7.fhir.us.davinci-atr";
const unsupportedParameters = [
  "_since",
  "_until",
  "_typeFilter",
  "patient",
] as const;

type NormalizedTypeParameter =
  | {
    normalized: SupportedResourceType[];
  }
  | {
    error: string;
  }
  | null;

type BulkRoutesOptions = {
  resolver: AtrResolver;
  jobRepository: ExportJobRepository;
  artifactStore: ExportArtifactStore;
  authMode: AuthMode;
};

const normalizeTypeParameter = (
  value: string | undefined | null,
): NormalizedTypeParameter => {
  if (!value) {
    return null;
  }

  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (values.length === 0) {
    return null;
  }

  const requested = new Set(values);
  const invalid = values.filter(
    (resourceType) =>
      !canonicalResourceTypeOrder.includes(
        resourceType as SupportedResourceType,
      ),
  );

  if (invalid.length > 0) {
    return { error: `Unsupported _type resource(s): ${invalid.join(", ")}.` };
  }

  const normalized = canonicalResourceTypeOrder.filter((type) =>
    requested.has(type)
  );
  return { normalized };
};

const buildCanonicalRequestUrl = (
  requestUrl: string,
  normalizedTypes: SupportedResourceType[],
  exportType: string,
) => {
  const url = new URL(requestUrl);
  url.search = "";
  url.searchParams.set("exportType", exportType);
  url.searchParams.set("_type", normalizedTypes.join(","));
  return url.toString();
};

const buildStoredManifest = (
  transactionTime: string,
  requestUrl: string,
  normalizedTypes: SupportedResourceType[],
  authMode: AuthMode,
): StoredManifest => ({
  transactionTime,
  request: requestUrl,
  requiresAccessToken: requiresAccessToken(authMode),
  output: normalizedTypes.map((type) => ({
    type,
    fileName: `${type}-1.ndjson`,
  })),
  error: [],
});

const buildPublicManifest = (
  origin: string,
  jobId: string,
  manifest: StoredManifest,
) => ({
  ...manifest,
  output: manifest.output.map((entry) => ({
    type: entry.type,
    url: `${origin}/fhir/bulk-files/${jobId}/${entry.fileName}`,
  })),
});

const processClaimedJob = async (
  claimedJob: ClaimedExportJob,
  authMode: AuthMode,
  jobRepository: ExportJobRepository,
  artifactStore: ExportArtifactStore,
  resolver: AtrResolver,
) => {
  const { claimToken, job } = claimedJob;
  const exportResources = resolver.buildExportResources(
    job.groupId,
    job.normalizedTypes,
  );
  if (!exportResources) {
    await jobRepository.markFailedWithClaim(claimedJob.job.jobId, claimToken, [
      "Group snapshot could not be resolved for export.",
    ]);
    return;
  }

  const files = [];
  for (const type of job.normalizedTypes) {
    const resources = exportResources[type] || [];
    const fileName = `${type}-1.ndjson`;
    const artifactKey = await artifactStore.writeNdjson(
      job.jobId,
      fileName,
      resources,
    );
    files.push({
      type,
      fileName,
      artifactKey,
    });
  }

  const manifest = buildStoredManifest(
    job.transactionTime,
    job.requestUrl,
    job.normalizedTypes,
    authMode,
  );
  const manifestKey = await artifactStore.writeManifest(job.jobId, manifest);
  await jobRepository.markCompletedWithClaim(
    job.jobId,
    claimToken,
    manifestKey,
    files,
  );
};

export const createBulkRoutes = ({
  resolver,
  jobRepository,
  artifactStore,
  authMode,
}: BulkRoutesOptions) => {
  const app = new Hono<AppEnv>();
  app.use("/Group/:id/$davinci-data-export", createAuthMiddleware(authMode));
  app.use("/bulk-status/:jobId", createAuthMiddleware(authMode));
  app.use("/bulk-files/:jobId/:fileName", createAuthMiddleware(authMode));

  app.get("/Group/:id/$davinci-data-export", async (context) => {
    const groupId = context.req.param("id");
    const group = resolver.getGroupById(groupId);
    if (!group) {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        "Group was not found.",
      );
    }

    const exportType = context.req.query("exportType");
    if (exportType !== exportTypeValue) {
      return fhirOperationOutcome(
        context,
        400,
        "invalid",
        `exportType must equal ${exportTypeValue}.`,
      );
    }

    const outputFormat = context.req.query("_outputFormat");
    const acceptedFormats = [
      "application/fhir+ndjson",
      "application/ndjson",
      "ndjson",
    ];
    if (outputFormat && !acceptedFormats.includes(outputFormat)) {
      return fhirOperationOutcome(
        context,
        400,
        "not-supported",
        `_outputFormat "${outputFormat}" is not supported. Accepted values: application/fhir+ndjson, application/ndjson, ndjson.`,
      );
    }

    for (const parameter of unsupportedParameters) {
      if (context.req.query(parameter)) {
        return fhirOperationOutcome(
          context,
          400,
          "not-supported",
          `${parameter} is not supported in phase 1.`,
        );
      }
    }

    const normalizedFromType = normalizeTypeParameter(
      context.req.query("_type"),
    );
    const normalizedFromAlias = normalizeTypeParameter(
      context.req.query("resourceTypes"),
    );

    if (normalizedFromType && "error" in normalizedFromType) {
      return fhirOperationOutcome(
        context,
        400,
        "invalid",
        normalizedFromType.error,
      );
    }
    if (normalizedFromAlias && "error" in normalizedFromAlias) {
      return fhirOperationOutcome(
        context,
        400,
        "invalid",
        normalizedFromAlias.error,
      );
    }

    const normalizedTypes = normalizedFromType?.normalized ||
      normalizedFromAlias?.normalized || null;

    if (!normalizedTypes) {
      return fhirOperationOutcome(
        context,
        400,
        "invalid",
        "_type is required and must include at least Group,Patient,Coverage.",
      );
    }

    if (
      normalizedFromType?.normalized &&
      normalizedFromAlias?.normalized &&
      normalizedFromType.normalized.join(",") !==
        normalizedFromAlias.normalized.join(",")
    ) {
      return fhirOperationOutcome(
        context,
        400,
        "invalid",
        "resourceTypes alias must match the canonical _type parameter when both are provided.",
      );
    }

    const missingMinimumTypes = minimumResourceTypes.filter(
      (type) => !normalizedTypes.includes(type),
    );
    if (missingMinimumTypes.length > 0) {
      return fhirOperationOutcome(
        context,
        400,
        "invalid",
        `Missing required _type values: ${missingMinimumTypes.join(", ")}.`,
      );
    }

    const transactionTime = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const requestUrl = buildCanonicalRequestUrl(
      context.req.url,
      normalizedTypes,
      exportTypeValue,
    );
    await jobRepository.createJob({
      jobId,
      groupId,
      transactionTime,
      requestUrl,
      normalizedTypes,
      exportType: exportTypeValue,
    });

    // Fire-and-forget: process export immediately in background.
    // The claim/lease mechanism in the poll handler acts as a retry path
    // if this processing fails or the Deno runtime restarts mid-flight.
    const claimedJob = await jobRepository.claimJob(jobId, "kickoff");
    if (claimedJob) {
      queueMicrotask(async () => {
        try {
          await processClaimedJob(
            claimedJob,
            authMode,
            jobRepository,
            artifactStore,
            resolver,
          );
        } catch (error: unknown) {
          const diagnostics = error instanceof Error
            ? error.message
            : "Background export processing failed.";
          await jobRepository.markFailedWithClaim(
            jobId,
            claimedJob.claimToken,
            [diagnostics],
          );
        }
      });
    }

    const contentLocation = `${
      new URL(context.req.url).origin
    }/fhir/bulk-status/${jobId}`;
    context.header("content-location", contentLocation);
    context.header("retry-after", "1");
    return context.body(null, 202);
  });

  app.get("/bulk-status/:jobId", async (context) => {
    const auth = context.get("auth");
    const callerId = getCallerId(auth);
    const jobId = context.req.param("jobId");
    const job = await jobRepository.getJob(jobId);

    if (!job || job.status === "expired") {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        "Bulk export job was not found.",
      );
    }

    if (!(await jobRepository.canPoll(jobId, callerId))) {
      context.header("retry-after", "1");
      return fhirOperationOutcome(
        context,
        429,
        "throttled",
        "Polling too frequently. Retry after one second.",
      );
    }

    let currentJob: Awaited<ReturnType<ExportJobRepository["getJob"]>> = job;

    // Fallback processing path: if the kick-off fire-and-forget did not
    // complete (e.g., runtime restart, transient error), the first poll
    // claims and processes the job inline. Under normal operation this
    // branch is not reached because kick-off already completed the export.
    if (currentJob.status === "accepted" || currentJob.status === "running") {
      const claimedJob = await jobRepository.claimJob(jobId, callerId);
      if (claimedJob) {
        try {
          await processClaimedJob(
            claimedJob,
            authMode,
            jobRepository,
            artifactStore,
            resolver,
          );
        } catch (error: unknown) {
          const diagnostics = error instanceof Error
            ? error.message
            : "Unexpected export generation failure.";
          await jobRepository.markFailedWithClaim(
            jobId,
            claimedJob.claimToken,
            [diagnostics],
          );
        }
      }

      currentJob = await jobRepository.getJob(jobId);
    }

    if (!currentJob || currentJob.status === "expired") {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        "Bulk export job was not found.",
      );
    }

    if (currentJob.status === "accepted" || currentJob.status === "running") {
      context.header("x-progress", currentJob.progress);
      context.header("retry-after", "1");
      return context.body(null, 202);
    }

    if (currentJob.status === "failed") {
      return fhirOperationOutcome(
        context,
        500,
        "exception",
        currentJob.error.join(" ") || "Bulk export job failed.",
      );
    }

    if (!currentJob.manifestKey) {
      return fhirOperationOutcome(
        context,
        500,
        "exception",
        "Bulk export job completed without a manifest key.",
      );
    }

    const manifest = await artifactStore.readManifest(currentJob.manifestKey);
    context.header("expires", currentJob.expiresAt);
    context.header("content-type", "application/json; charset=utf-8");
    return context.json(
      buildPublicManifest(new URL(context.req.url).origin, jobId, manifest),
    );
  });

  app.delete("/bulk-status/:jobId", async (context) => {
    const jobId = context.req.param("jobId");
    const job = await jobRepository.getJob(jobId);

    if (!job || job.status === "expired") {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        "Bulk export job was not found.",
      );
    }

    await jobRepository.expireJob(jobId);
    return context.body(null, 202);
  });

  app.get("/bulk-files/:jobId/:fileName", async (context) => {
    const jobId = context.req.param("jobId");
    const fileName = context.req.param("fileName");
    const job = await jobRepository.getJob(jobId);

    if (!job || job.status === "expired") {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        "Bulk export job was not found.",
      );
    }

    const file = job.files.find((entry) => entry.fileName === fileName);
    if (!file) {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        "Bulk export file was not found.",
      );
    }

    try {
      const content = await artifactStore.readNdjson(file.artifactKey);
      context.header("content-type", "application/fhir+ndjson; charset=utf-8");
      return context.body(content, 200);
    } catch {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        "Bulk export file was not found.",
      );
    }
  });

  return app;
};
