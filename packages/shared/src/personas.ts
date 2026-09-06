import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { personaConfigSchema, type PersonaConfig } from "./schemas.js";

export async function loadPersonaFile(filePath: string): Promise<PersonaConfig> {
  const raw = await readFile(filePath, "utf8");
  const data = parse(raw);
  return personaConfigSchema.parse(data);
}

export async function loadPersonasDir(dir: string): Promise<PersonaConfig[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();

  return Promise.all(files.map(loadPersonaFile));
}

export function resolveRunnerUrl(
  persona: PersonaConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (persona.runner?.url) {
    return persona.runner.url.replace(/\/$/, "");
  }

  const override = env[`PERSONA_${persona.id.toUpperCase().replace(/-/g, "_")}_URL`];
  if (override) {
    return override.replace(/\/$/, "");
  }

  const base = env.PERSONA_RUNNER_BASE_URL;
  if (base) {
    return `${base.replace(/\/$/, "")}/${persona.id}`;
  }

  return `https://${persona.fly.app}.fly.dev`;
}
