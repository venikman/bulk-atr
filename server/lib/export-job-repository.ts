import type {
  ExportFileRecord,
  ExportJobRecord,
  SupportedResourceType,
} from "./types.ts";

export type CreateExportJobInput = {
  jobId: string;
  groupId: string;
  transactionTime: string;
  requestUrl: string;
  normalizedTypes: SupportedResourceType[];
  exportType: string;
};

export type ClaimedExportJob = {
  claimToken: string;
  job: ExportJobRecord;
};

export interface ExportJobRepository {
  createJob(input: CreateExportJobInput): Promise<ExportJobRecord>;
  getJob(jobId: string): Promise<ExportJobRecord | null>;
  claimJob(jobId: string, workerId: string): Promise<ClaimedExportJob | null>;
  markRunning(jobId: string, progress: string): Promise<ExportJobRecord | null>;
  markCompleted(
    jobId: string,
    manifestKey: string,
    files: ExportFileRecord[],
  ): Promise<ExportJobRecord | null>;
  markCompletedWithClaim(
    jobId: string,
    claimToken: string,
    manifestKey: string,
    files: ExportFileRecord[],
  ): Promise<ExportJobRecord | null>;
  markFailed(
    jobId: string,
    diagnostics: string[],
  ): Promise<ExportJobRecord | null>;
  markFailedWithClaim(
    jobId: string,
    claimToken: string,
    diagnostics: string[],
  ): Promise<ExportJobRecord | null>;
  canPoll(jobId: string, callerId: string): Promise<boolean>;
}
