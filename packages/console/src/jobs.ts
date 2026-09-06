import { randomUUID } from "node:crypto";
import type { MissionEvent } from "@persona-system/shared";

export type JobType = "deploy" | "sync-secrets" | "health" | "eval";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface SessionFrame {
  personaId?: string;
  tool?: string;
  thought?: string;
  screenshot?: { mime: string; data: string; caption?: string };
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  label: string;
  logs: string[];
  events: MissionEvent[];
  session: SessionFrame;
  prompt?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const jobs = new Map<string, Job>();
const MAX_JOBS = 30;
const MAX_EVENTS = 200;

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

export function publicJob(job: Job): Omit<Job, "events"> & { events: MissionEvent[] } {
  return {
    ...job,
    session: {
      ...job.session,
      screenshot: job.session.screenshot
        ? { mime: job.session.screenshot.mime, caption: job.session.screenshot.caption, data: "[omitted]" }
        : undefined,
    },
    events: job.events.map((event) =>
      event.type === "screenshot" ? { ...event, data: event.data ? "[omitted]" : undefined } : event,
    ),
  };
}

export function createJob(type: JobType, label: string, prompt?: string): Job {
  const job: Job = {
    id: randomUUID(),
    type,
    status: "queued",
    label,
    logs: [],
    events: [],
    session: {},
    prompt,
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

export function appendJobEvent(job: Job, event: MissionEvent) {
  job.events.push(event);
  if (job.events.length > MAX_EVENTS) job.events.shift();

  if (event.personaId) job.session.personaId = event.personaId;
  if (event.type === "tool") job.session.tool = event.name ?? event.message;
  if (event.type === "thought" && event.text) job.session.thought = event.text;
  if (event.type === "screenshot" && event.data) {
    job.session.screenshot = {
      mime: event.mime ?? "image/jpeg",
      data: event.data,
      caption: event.caption,
    };
  }
  if (event.type === "status" && event.message) appendJobLog(job, event.message);
  if (event.type === "tool") appendJobLog(job, `⚙ ${event.name ?? event.message}`);
  if (event.type === "thought" && event.text) appendJobLog(job, event.text.slice(0, 240));
  if (event.type === "error" && event.message) appendJobLog(job, `✗ ${event.message}`);

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
