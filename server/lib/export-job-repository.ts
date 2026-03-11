import type { ExportFileRecord, ExportJobRecord, SupportedResourceType } from './types.js';

export type CreateExportJobInput = {
  jobId: string;
  groupId: string;
  transactionTime: string;
  requestUrl: string;
  normalizedTypes: SupportedResourceType[];
  exportType: string;
};

export interface ExportJobRepository {
  createJob(input: CreateExportJobInput): Promise<ExportJobRecord>;
  getJob(jobId: string): Promise<ExportJobRecord | null>;
  markRunning(jobId: string, progress: string): Promise<ExportJobRecord | null>;
  markCompleted(
    jobId: string,
    manifestKey: string,
    files: ExportFileRecord[],
  ): Promise<ExportJobRecord | null>;
  markFailed(jobId: string, diagnostics: string[]): Promise<ExportJobRecord | null>;
  canPoll(jobId: string, callerId: string): Promise<boolean>;
}
