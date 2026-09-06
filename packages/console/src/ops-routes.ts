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
import {
  createJob,
  getJob,
  listJobs,
  runJob,
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
  productUrl: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  focus?: string;
}

export function registerOpsRoutes(app: FastifyInstance, ctx: OpsContext) {
  app.get("/api/ops/jobs", async () => listJobs());

  app.get<{ Params: { id: string } }>("/api/ops/jobs/:id", async (request, reply) => {
    const job = getJob(request.params.id);
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    return job;
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

  app.post<{ Body: EvalBody }>("/api/ops/eval", async (request, reply) => {
    const body = request.body;
    if (!body?.productUrl) {
      return reply.code(400).send({ error: "productUrl required" });
    }

    const job = createJob("eval", `Eval ${body.productUrl}`);

    void runJob(job, async (log) => {
      const { runDir, results } = await runEval({
        productUrl: body.productUrl,
        personasDir: ctx.personasDir,
        personaIds: body.personaIds,
        focus: body.focus,
        username: body.username,
        password: body.password,
        loginUrl: body.loginUrl,
        outDir: path.join(ctx.repoRoot, "artifacts", "evaluations", `ui-${Date.now()}`),
        onLog: log,
      });
      const reportPath = await writeReport(runDir, body.productUrl, results);
      log(`Báo cáo: ${reportPath}`);
      return { runDir, reportPath, results, failed: results.filter((r: PersonaEvalResult) => !r.ok).length };
    });

    return reply.code(202).send({ jobId: job.id });
  });
}
