import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import {
  defaultPersonaConfig,
  deletePersonaFile,
  loadPersonaFile,
  loadPersonasDir,
  loadProjectEnv,
  maskApiKey,
  personaConfigSchema,
  personaFilePath,
  resolveLlmConfig,
  savePersonaFile,
} from "@persona-system/shared";
import { registerOpsRoutes } from "./ops-routes.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const personasDir = process.env.PERSONAS_DIR ?? path.join(repoRoot, "personas");
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/config/llm", async () => {
    try {
      const config = await resolveLlmConfig({ repoRoot });
      return {
        ok: true,
        source: config.source,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKeyMasked: maskApiKey(config.apiKey),
        envPath: path.join(repoRoot, ".env"),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "unknown error",
        envPath: path.join(repoRoot, ".env"),
      };
    }
  });

  app.get("/api/personas", async () => {
    const personas = await loadPersonasDir(personasDir);
    return personas.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      flyApp: p.fly.app,
    }));
  });

  app.get<{ Params: { id: string } }>("/api/personas/:id", async (request, reply) => {
    try {
      return await loadPersonaFile(personaFilePath(personasDir, request.params.id));
    } catch {
      return reply.code(404).send({ error: "persona_not_found" });
    }
  });

  app.post<{ Body: unknown }>("/api/personas", async (request, reply) => {
    const parsed = personaConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_persona", details: parsed.error.flatten() });
    }

    try {
      await loadPersonaFile(personaFilePath(personasDir, parsed.data.id));
      return reply.code(409).send({ error: "persona_exists" });
    } catch {
      // new persona
    }

    await savePersonaFile(personasDir, parsed.data);
    return reply.code(201).send(parsed.data);
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/personas/:id", async (request, reply) => {
    const parsed = personaConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_persona", details: parsed.error.flatten() });
    }
    if (parsed.data.id !== request.params.id) {
      return reply.code(400).send({ error: "id_mismatch" });
    }

    await savePersonaFile(personasDir, parsed.data);
    return parsed.data;
  });

  app.delete<{ Params: { id: string } }>("/api/personas/:id", async (request, reply) => {
    const deleted = await deletePersonaFile(personasDir, request.params.id);
    if (!deleted) return reply.code(404).send({ error: "persona_not_found" });
    return { ok: true };
  });

  app.get("/api/personas/template/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return defaultPersonaConfig(id);
  });

  registerOpsRoutes(app, { repoRoot, personasDir });

  return app;
}

async function main() {
  await loadProjectEnv(repoRoot);
  const app = await buildServer();
  const port = Number(process.env.CONSOLE_PORT ?? 8787);
  await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
  console.log(`Persona console: http://localhost:${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
