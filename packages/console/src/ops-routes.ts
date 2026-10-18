import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  checkPersonasHealth,
  deployPersonas,
  runEval,
  syncLlmSecrets,
  writeReport,
} from "@persona-system/orchestrator";
import { loadPersonasDir, resolveNovncUrl, resolveRunnerUrl } from "@persona-system/shared";
import {
  createJob,
  getJob,
  listJobs,
  publicJob,
  appendJobEvent,
  appendJobLog,
  initPersonaSessions,
  runJob,
  setPersonaStatus,
  subscribeJob,
} from "./jobs.js";
import type { PersonaEvalResult } from "@persona-system/orchestrator";

interface OpsContext {
  repoRoot: string;
  personasDir: string;
}

interface PersonaIdsBody {
  personaIds?: string[];
}

interface EvalBody extends PersonaIdsBody {
  prompt: string;
  productUrl?: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  personaAccountPrompts?: Record<string, string>;
}

function writeSse(reply: { raw: NodeJS.WritableStream }, data: unknown) {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function runnerAuthHeaders(): Record<string, string> {
  const token = process.env.RUNNER_AUTH_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function callRunnerHandoff(
  runnerUrl: string,
  action: "pause" | "resume",
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${runnerUrl.replace(/\/$/, "")}/missions/control`;
  const response = await fetch(url, {
    method: "POST",
    headers: runnerAuthHeaders(),
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(15_000),
  });
  let body: unknown = {};
  try {
    body = await response.json();
  } catch {
    body = { error: response.statusText };
  }
  return { ok: response.ok, status: response.status, body };
}

export function registerOpsRoutes(app: FastifyInstance, ctx: OpsContext) {
  app.get("/api/ops/jobs", async () => listJobs().map(publicJob));

  app.get<{ Params: { id: string } }>("/api/ops/jobs/:id", async (request, reply) => {
    const job = getJob(request.params.id);
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    return publicJob(job);
  });

  app.get<{ Params: { id: string }; Querystring: { personaId?: string } }>(
    "/api/ops/jobs/:id/screen",
    async (request, reply) => {
      const job = getJob(request.params.id);
      if (!job) return reply.code(404).send({ error: "job_not_found" });

      const personaId = request.query.personaId;
      const session = personaId ? job.sessions[personaId] : undefined;

      return {
        status: job.status,
        session: session
          ? {
              personaId: session.personaId,
              personaName: session.personaName,
              tool: session.tool,
              thought: session.thought,
              lastAction: session.lastAction,
              status: session.status,
              screenshot: session.screenshot,
            }
          : job.session,
        prompt: job.prompt,
        thought: session?.thought ?? job.session.thought,
        tool: session?.tool ?? job.session.tool,
      };
    },
  );

  app.get<{ Params: { id: string } }>("/api/ops/jobs/:id/stream", async (request, reply) => {
    const job = getJob(request.params.id);
    if (!job) return reply.code(404).send({ error: "job_not_found" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    const snapshot = publicJob(job);
    writeSse(reply, { type: "snapshot", job: snapshot });

    for (const [personaId, session] of Object.entries(job.sessions)) {
      if (session.screenshot?.data) {
        writeSse(reply, {
          type: "frame",
          personaId,
          mime: session.screenshot.mime,
          data: session.screenshot.data,
          caption: session.screenshot.caption,
        });
      }
      writeSse(reply, {
        type: "persona",
        personaId,
        status: session.status,
        personaName: session.personaName,
        error: session.error,
      });
    }

    writeSse(reply, { type: "job", status: job.status, logs: job.logs });

    const unsubscribe = subscribeJob(job.id, (message) => writeSse(reply, message));

    request.raw.on("close", () => {
      unsubscribe();
    });
  });

  app.get("/api/ops/runs", async () => {
    const runsDir = path.join(ctx.repoRoot, "artifacts", "evaluations");
    try {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const runs = [];
      for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
        const reportPath = path.join(runsDir, entry.name, "report.md");
        let hasReport = false;
        try {
          await readFile(reportPath);
          hasReport = true;
        } catch {
          // no report
        }
        runs.push({ id: entry.name, hasReport, reportPath: hasReport ? reportPath : null });
      }
      return runs;
    } catch {
      return [];
    }
  });

  app.get<{ Params: { id: string } }>("/api/ops/runs/:id/report", async (request, reply) => {
    const reportPath = path.join(ctx.repoRoot, "artifacts", "evaluations", request.params.id, "report.md");
    try {
      const content = await readFile(reportPath, "utf8");
      return { id: request.params.id, content };
    } catch {
      return reply.code(404).send({ error: "report_not_found" });
    }
  });

  app.post<{ Body: PersonaIdsBody }>("/api/ops/deploy", async (request, reply) => {
    const personaIds = request.body?.personaIds;
    const label = personaIds?.length
      ? `Deploy ${personaIds.length} persona(s)`
      : "Deploy tất cả persona";
    const job = createJob("deploy", label);

    void runJob(job, async (log) =>
      deployPersonas({
        repoRoot: ctx.repoRoot,
        personasDir: ctx.personasDir,
        personaIds,
        onLog: log,
      }),
    );

    return reply.code(202).send({ jobId: job.id });
  });

  app.post<{ Body: PersonaIdsBody }>("/api/ops/sync-secrets", async (request, reply) => {
    const personaIds = request.body?.personaIds;
    const job = createJob("sync-secrets", "Sync LLM secrets lên Fly");

    void runJob(job, async (log) =>
      syncLlmSecrets({
        repoRoot: ctx.repoRoot,
        personasDir: ctx.personasDir,
        personaIds,
        onLog: log,
      }),
    );

    return reply.code(202).send({ jobId: job.id });
  });

  app.post<{ Body: PersonaIdsBody }>("/api/ops/health", async (request, reply) => {
    const personaIds = request.body?.personaIds;
    const job = createJob("health", "Kiểm tra health runners");

    void runJob(job, async (log) => {
      log("Đang ping /health...");
      const results = await checkPersonasHealth({
        personasDir: ctx.personasDir,
        personaIds,
      });
      for (const r of results) {
        log(
          r.ok
            ? `✓ ${r.personaId} (${r.latencyMs}ms)`
            : `✗ ${r.personaId}: ${r.error ?? "unhealthy"}`,
        );
      }
      return { results };
    });

    return reply.code(202).send({ jobId: job.id });
  });

  app.post<{
    Params: { jobId: string; personaId: string };
    Body: { action?: string };
  }>("/api/ops/jobs/:jobId/personas/:personaId/handoff", async (request, reply) => {
    const job = getJob(request.params.jobId);
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    if (job.type !== "eval") return reply.code(400).send({ error: "handoff_only_for_eval_jobs" });

    const { personaId } = request.params;
    const session = job.sessions[personaId];
    if (!session) return reply.code(404).send({ error: "persona_not_in_job" });

    const action = request.body?.action;
    if (action !== "pause" && action !== "resume") {
      return reply.code(400).send({ error: "invalid_action", allowed: ["pause", "resume"] });
    }

    if (action === "pause" && session.status !== "running") {
      return reply.code(409).send({ error: "cannot_pause", status: session.status });
    }
    if (action === "resume" && session.status !== "paused_for_human") {
      return reply.code(409).send({ error: "cannot_resume", status: session.status });
    }

    const personas = await loadPersonasDir(ctx.personasDir);
    const persona = personas.find((p) => p.id === personaId);
    if (!persona) return reply.code(404).send({ error: "persona_not_found" });

    const runnerResult = await callRunnerHandoff(resolveRunnerUrl(persona), action);
    if (!runnerResult.ok) {
      return reply.code(runnerResult.status).send(runnerResult.body);
    }

    if (action === "pause") {
      setPersonaStatus(job, personaId, "paused_for_human");
      appendJobLog(job, `⏸ ${persona.name}: tạm dừng agent — bạn điều khiển VM qua noVNC`);
    } else {
      setPersonaStatus(job, personaId, "running");
      appendJobLog(job, `▶ ${persona.name}: agent tiếp tục`);
    }

    return {
      ok: true,
      personaId,
      status: action === "pause" ? "paused_for_human" : "running",
    };
  });

  app.post<{ Body: EvalBody }>("/api/ops/eval", async (request, reply) => {
    const body = request.body;
    if (!body?.prompt?.trim()) {
      return reply.code(400).send({ error: "prompt required" });
    }

    const personaIds = body.personaIds;
    const allPersonas = await loadPersonasDir(ctx.personasDir);
    const selected = personaIds?.length
      ? allPersonas.filter((p) => personaIds.includes(p.id))
      : allPersonas;

    const job = createJob(
      "eval",
      body.prompt.trim().slice(0, 80),
      body.prompt.trim(),
      selected.map((p) => p.id),
    );
    initPersonaSessions(
      job,
      selected.map((p) => ({
        id: p.id,
        name: p.name,
        novncUrl: resolveNovncUrl(p),
      })),
    );

    void runJob(job, async (log) => {
      const { runDir, results } = await runEval({
        prompt: body.prompt.trim(),
        productUrl: body.productUrl,
        personasDir: ctx.personasDir,
        personaIds: body.personaIds,
        username: body.username,
        password: body.password,
        loginUrl: body.loginUrl,
        personaAccountPrompts: body.personaAccountPrompts,
        outDir: path.join(ctx.repoRoot, "artifacts", "evaluations", `ui-${Date.now()}`),
        onLog: log,
        onEvent: (event) => appendJobEvent(job, event),
      });

      for (const result of results) {
        setPersonaStatus(
          job,
          result.persona.id,
          result.ok ? "completed" : "failed",
          result.error,
        );
      }

      const reportPath = await writeReport(runDir, body.prompt.trim(), results);
      log(`Báo cáo: ${reportPath}`);
      return { runDir, reportPath, results, failed: results.filter((r: PersonaEvalResult) => !r.ok).length };
    });

    return reply.code(202).send({
      jobId: job.id,
      personaIds: selected.map((p) => p.id),
      novncUrls: Object.fromEntries(selected.map((p) => [p.id, resolveNovncUrl(p)])),
    });
  });
}
