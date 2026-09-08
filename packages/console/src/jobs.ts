import { randomUUID } from "node:crypto";
import type { MissionEvent } from "@persona-system/shared";

export type JobType = "deploy" | "sync-secrets" | "health" | "eval";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type PersonaSessionStatus = "pending" | "running" | "completed" | "failed";

export interface SessionFrame {
  personaId?: string;
  tool?: string;
  thought?: string;
  screenshot?: { mime: string; data: string; caption?: string };
}

export interface PersonaSession {
  personaId: string;
  personaName?: string;
  status: PersonaSessionStatus;
  tool?: string;
  thought?: string;
  lastAction?: string;
  screenshot?: { mime: string; data: string; caption?: string };
  events: MissionEvent[];
  error?: string;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  label: string;
  logs: string[];
  events: MissionEvent[];
  session: SessionFrame;
  personaIds?: string[];
  sessions: Record<string, PersonaSession>;
  prompt?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type JobStreamMessage =
  | { type: "job"; status: JobStatus; logs?: string[] }
  | { type: "persona"; personaId: string; status: PersonaSessionStatus; personaName?: string; error?: string }
  | { type: "event"; personaId: string; event: MissionEvent }
  | { type: "frame"; personaId: string; mime: string; data: string; caption?: string }
  | { type: "log"; line: string };

type JobSubscriber = (message: JobStreamMessage) => void;

const jobs = new Map<string, Job>();
const subscribers = new Map<string, Set<JobSubscriber>>();
const MAX_JOBS = 30;
const MAX_EVENTS = 200;
const MAX_PERSONA_EVENTS = 120;

function trimJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const job of sorted.slice(0, jobs.size - MAX_JOBS)) {
    jobs.delete(job.id);
    subscribers.delete(job.id);
  }
}

function publish(job: Job, message: JobStreamMessage) {
  const subs = subscribers.get(job.id);
  if (!subs?.size) return;
  for (const sub of subs) sub(message);
}

export function subscribeJob(jobId: string, listener: JobSubscriber): () => void {
  if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
  subscribers.get(jobId)!.add(listener);
  return () => subscribers.get(jobId)?.delete(listener);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

function omitScreenshotData<T extends { data?: string }>(shot?: T) {
  if (!shot?.data) return undefined;
  return { ...shot, data: "[omitted]" as const };
}

export function publicPersonaSession(session: PersonaSession): PersonaSession {
  return {
    ...session,
    screenshot: omitScreenshotData(session.screenshot),
    events: session.events.map((event) =>
      event.type === "screenshot" ? { ...event, data: event.data ? "[omitted]" : undefined } : event,
    ),
  };
}

export function publicJob(job: Job): Omit<Job, "events" | "sessions"> & {
  events: MissionEvent[];
  sessions: Record<string, PersonaSession>;
} {
  const sessions: Record<string, PersonaSession> = {};
  for (const [id, session] of Object.entries(job.sessions)) {
    sessions[id] = publicPersonaSession(session);
  }

  return {
    ...job,
    session: {
      ...job.session,
      screenshot: omitScreenshotData(job.session.screenshot),
    },
    sessions,
    events: job.events.map((event) =>
      event.type === "screenshot" ? { ...event, data: event.data ? "[omitted]" : undefined } : event,
    ),
  };
}

export function initPersonaSessions(
  job: Job,
  personas: Array<{ id: string; name: string }>,
) {
  job.personaIds = personas.map((p) => p.id);
  job.sessions = {};
  for (const persona of personas) {
    job.sessions[persona.id] = {
      personaId: persona.id,
      personaName: persona.name,
      status: "pending",
      events: [],
    };
  }
  job.updatedAt = new Date().toISOString();
}

function ensurePersonaSession(job: Job, personaId: string): PersonaSession {
  if (!job.sessions[personaId]) {
    job.sessions[personaId] = {
      personaId,
      status: "running",
      events: [],
    };
  }
  return job.sessions[personaId];
}

function formatAction(event: MissionEvent): string | undefined {
  if (event.type === "tool") return `⚙ ${event.name ?? event.message ?? "tool"}`;
  if (event.type === "thought" && event.text) return event.text.slice(0, 160);
  if (event.type === "status" && event.message) return event.message;
  if (event.type === "result") return "✓ Hoàn thành đánh giá";
  if (event.type === "error") return `✗ ${event.message ?? "Lỗi"}`;
  return event.message;
}

export function createJob(
  type: JobType,
  label: string,
  prompt?: string,
  personaIds?: string[],
): Job {
  const job: Job = {
    id: randomUUID(),
    type,
    status: "queued",
    label,
    logs: [],
    events: [],
    session: {},
    sessions: {},
    personaIds,
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
  publish(job, { type: "log", line });
}

function appendPersonaEvent(job: Job, session: PersonaSession, event: MissionEvent) {
  session.events.push(event);
  if (session.events.length > MAX_PERSONA_EVENTS) session.events.shift();

  const action = formatAction(event);
  if (action) session.lastAction = action;

  if (event.type === "tool") session.tool = event.name ?? event.message;
  if (event.type === "thought" && event.text) session.thought = event.text;
  if (event.type === "screenshot" && event.data) {
    session.screenshot = {
      mime: event.mime ?? "image/jpeg",
      data: event.data,
      caption: event.caption,
    };
  }
  if (event.type === "error" && event.message) session.error = event.message;
  if (event.type === "result") session.status = "completed";
}

export function appendJobEvent(job: Job, event: MissionEvent) {
  job.events.push(event);
  if (job.events.length > MAX_EVENTS) job.events.shift();

  const personaId = event.personaId;
  if (personaId) {
    const session = ensurePersonaSession(job, personaId);
    if (session.status === "pending") session.status = "running";
    appendPersonaEvent(job, session, event);
    job.session = {
      personaId,
      tool: session.tool,
      thought: session.thought,
      screenshot: session.screenshot,
    };

    if (event.type !== "screenshot") {
      publish(job, { type: "event", personaId, event });
    }

    if (event.type === "screenshot" && event.data) {
      publish(job, {
        type: "frame",
        personaId,
        mime: event.mime ?? "image/jpeg",
        data: event.data,
        caption: event.caption,
      });
    }
  }

  if (event.type === "status" && event.message) appendJobLog(job, event.message);
  if (event.type === "tool") appendJobLog(job, `⚙ ${event.name ?? event.message}`);
  if (event.type === "thought" && event.text) appendJobLog(job, event.text.slice(0, 240));
  if (event.type === "error" && event.message) appendJobLog(job, `✗ ${event.message}`);

  job.updatedAt = new Date().toISOString();
}

export function setPersonaStatus(
  job: Job,
  personaId: string,
  status: PersonaSessionStatus,
  error?: string,
) {
  const session = ensurePersonaSession(job, personaId);
  session.status = status;
  if (error) session.error = error;
  job.updatedAt = new Date().toISOString();
  publish(job, { type: "persona", personaId, status, personaName: session.personaName, error });
}

export function setJobRunning(job: Job) {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  publish(job, { type: "job", status: job.status });
}

export function setJobCompleted(job: Job, result?: unknown) {
  job.status = "completed";
  job.result = result;
  job.updatedAt = new Date().toISOString();
  publish(job, { type: "job", status: job.status });
}

export function setJobFailed(job: Job, error: string) {
  job.status = "failed";
  job.error = error;
  job.updatedAt = new Date().toISOString();
  publish(job, { type: "job", status: job.status });
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
