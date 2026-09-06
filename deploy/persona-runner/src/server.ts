import Fastify from "fastify";
import { missionRequestSchema } from "@persona-system/shared";
import { runMission } from "./agent.js";

function authorize(authHeader: string | undefined): boolean {
  const token = process.env.RUNNER_AUTH_TOKEN;
  if (!token) return true;
  return authHeader === `Bearer ${token}`;
}

export async function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    ok: true,
    persona_id: process.env.PERSONA_ID ?? "unknown",
  }));

  app.post("/missions", async (request, reply) => {
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

    try {
      return await runMission(parsed.data);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({
        error: "mission_failed",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  return app;
}

async function main() {
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
