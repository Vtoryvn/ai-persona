import { randomUUID } from "node:crypto";

export type JobType = "deploy" | "sync-secrets" | "health" | "eval";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  label: string;
  logs: string[];
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const jobs = new Map<string, Job>();
const MAX_JOBS = 30;

function trimJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const job of sorted.slice(0, jobs.size - MAX_JOBS)) jobs.delete(job.id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function createJob(type: JobType, label: string): Job {
  const job: Job = {
    id: randomUUID(),
    type,
    status: "queued",
    label,
    logs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  trimJobs();
  return job;
}

export function appendJobLog(job: Job, line: string) {
  job.logs.push(line);
  if (job.logs.length > 500) job.logs.shift();
  job.updatedAt = new Date().toISOString();
}

export function setJobRunning(job: Job) {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
}

export function setJobCompleted(job: Job, result?: unknown) {
  job.status = "completed";
  job.result = result;
  job.updatedAt = new Date().toISOString();
}

export function setJobFailed(job: Job, error: string) {
  job.status = "failed";
  job.error = error;
  job.updatedAt = new Date().toISOString();
}

export async function runJob(job: Job, task: (log: (line: string) => void) => Promise<unknown>) {
  setJobRunning(job);
  const log = (line: string) => appendJobLog(job, line);
  try {
    log(`▶ ${job.label}`);
    const result = await task(log);
    setJobCompleted(job, result);
    log("✓ Hoàn tất");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setJobFailed(job, message);
    log(`✗ ${message}`);
  }
}
