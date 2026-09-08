import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectEnv, missionRequestSchema, type MissionEvent } from "@persona-system/shared";
import { runMission, isChromeDebugReady } from "./agent.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function authorize(authHeader: string | undefined): boolean {
  const token = process.env.RUNNER_AUTH_TOKEN;
  if (!token) return true;
  return authHeader === `Bearer ${token}`;
}

function wantsStream(accept: string | undefined, body: unknown): boolean {
  if (accept?.includes("text/event-stream")) return true;
  return Boolean(body && typeof body === "object" && (body as { stream?: boolean }).stream);
}

export async function buildServer() {
  const app = Fastify({ logger: true, requestTimeout: 0, connectionTimeout: 0 });

  app.get("/health", async () => {
    const chromeReady = await isChromeDebugReady();
    return {
      ok: true,
      persona_id: process.env.PERSONA_ID ?? "unknown",
      chrome_ready: chromeReady,
      novnc_port: Number(process.env.NOVNC_PORT ?? 6080),
    };
  });

  app.post("/missions", async (request, reply) => {
    request.raw.setTimeout(0);
    reply.raw.setTimeout(0);

    if (!authorize(request.headers.authorization)) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = missionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_mission",
        details: parsed.error.flatten(),
      });
    }

    const stream = wantsStream(request.headers.accept, request.body);

    try {
      if (!stream) {
        return await runMission(parsed.data);
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const send = (event: MissionEvent) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const result = await runMission(parsed.data, send);
      send({
        type: "result",
        at: new Date().toISOString(),
        personaId: parsed.data.persona_id,
        result,
        text: result.response,
      });
      reply.raw.write("event: done\ndata: {}\n\n");
      reply.raw.end();
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : "unknown error";
      if (stream && reply.raw.headersSent) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: "error", at: new Date().toISOString(), message })}\n\n`,
        );
        reply.raw.end();
        return;
      }
      if (!reply.sent) {
        return reply.code(500).send({ error: "mission_failed", message });
      }
    }
  });

  return app;
}

async function main() {
  await loadProjectEnv(repoRoot);
  const app = await buildServer();
  await app.listen({
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
