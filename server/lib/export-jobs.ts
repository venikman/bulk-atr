import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ExportFileRecord, ExportJobRecord, SupportedResourceType } from './types.js';

const STATUS_POLL_WINDOW_MS = 1000;
const COMPLETED_JOB_TTL_MS = 60 * 60 * 1000;
const ACTIVE_JOB_TTL_MS = 15 * 60 * 1000;

type CreateJobInput = {
  jobId: string;
  groupId: string;
  transactionTime: string;
  requestUrl: string;
  normalizedTypes: SupportedResourceType[];
  exportType: string;
};

const addMs = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();

export class ExportJobStore {
  readonly runtimeDir: string;

  readonly jobsDir: string;

  readonly pollMap = new Map<string, number>();

  constructor(runtimeDir: string) {
    this.runtimeDir = resolve(runtimeDir);
    this.jobsDir = join(this.runtimeDir, 'jobs');
  }

  async init() {
    await mkdir(this.jobsDir, { recursive: true });
  }

  private getJobPath(jobId: string) {
    return join(this.jobsDir, `${jobId}.json`);
  }

  private async writeJob(job: ExportJobRecord) {
    const path = this.getJobPath(job.jobId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(job, null, 2)}\n`, 'utf-8');
  }

  async createJob(input: CreateJobInput) {
    const now = new Date().toISOString();
    const job: ExportJobRecord = {
      jobId: input.jobId,
      groupId: input.groupId,
      status: 'accepted',
      transactionTime: input.transactionTime,
      requestUrl: input.requestUrl,
      normalizedTypes: input.normalizedTypes,
      exportType: input.exportType,
      createdAt: now,
      updatedAt: now,
      expiresAt: addMs(now, ACTIVE_JOB_TTL_MS),
      progress: 'accepted',
      manifestPath: null,
      files: [],
      error: [],
    };

    await this.writeJob(job);
    return job;
  }

  async getJob(jobId: string) {
    try {
      const content = await readFile(this.getJobPath(jobId), 'utf-8');
      const job = JSON.parse(content) as ExportJobRecord;
      if (new Date(job.expiresAt).getTime() <= Date.now()) {
        const expiredJob = {
          ...job,
          status: 'expired' as const,
          updatedAt: new Date().toISOString(),
        };
        await this.writeJob(expiredJob);
        return expiredJob;
      }

      return job;
    } catch {
      return null;
    }
  }

  async updateJob(jobId: string, updater: (job: ExportJobRecord) => ExportJobRecord) {
    const current = await this.getJob(jobId);
    if (!current) {
      return null;
    }

    const updated = updater(current);
    await this.writeJob(updated);
    return updated;
  }

  async markRunning(jobId: string, progress: string) {
    return this.updateJob(jobId, (job) => ({
      ...job,
      status: 'running',
      progress,
      updatedAt: new Date().toISOString(),
      expiresAt: addMs(new Date().toISOString(), ACTIVE_JOB_TTL_MS),
    }));
  }

  async markCompleted(jobId: string, manifestPath: string, files: ExportFileRecord[]) {
    return this.updateJob(jobId, (job) => ({
      ...job,
      status: 'completed',
      progress: 'completed',
      manifestPath,
      files,
      updatedAt: new Date().toISOString(),
      expiresAt: addMs(new Date().toISOString(), COMPLETED_JOB_TTL_MS),
    }));
  }

  async markFailed(jobId: string, diagnostics: string[]) {
    return this.updateJob(jobId, (job) => ({
      ...job,
      status: 'failed',
      progress: 'failed',
      error: diagnostics,
      updatedAt: new Date().toISOString(),
      expiresAt: addMs(new Date().toISOString(), COMPLETED_JOB_TTL_MS),
    }));
  }

  canPoll(jobId: string, callerId: string) {
    const key = `${jobId}:${callerId}`;
    const now = Date.now();
    const lastPoll = this.pollMap.get(key);
    if (lastPoll && now - lastPoll < STATUS_POLL_WINDOW_MS) {
      return false;
    }
    this.pollMap.set(key, now);
    return true;
  }
}
