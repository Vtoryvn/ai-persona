import { access, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
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

export function personaFilePath(dir: string, id: string): string {
  return path.join(dir, `${id}.yaml`);
}

export function serializePersona(config: PersonaConfig): string {
  const doc = {
    id: config.id,
    name: config.name,
    description: config.description,
    instructions: config.instructions.trimEnd(),
    evaluation: {
      rubric: config.evaluation?.rubric ?? [],
      output_format: config.evaluation?.output_format ?? "json",
    },
    browser: config.browser,
    fly: config.fly,
    ...(config.runner ? { runner: config.runner } : {}),
  };
  return `${stringify(doc, { lineWidth: 0 })}\n`;
}

export async function savePersonaFile(dir: string, config: PersonaConfig): Promise<string> {
  const parsed = personaConfigSchema.parse(config);
  const filePath = personaFilePath(dir, parsed.id);
  await writeFile(filePath, serializePersona(parsed), "utf8");
  return filePath;
}

export async function deletePersonaFile(dir: string, id: string): Promise<boolean> {
  const filePath = personaFilePath(dir, id);
  try {
    await access(filePath);
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
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

export function defaultPersonaConfig(id: string): PersonaConfig {
  return personaConfigSchema.parse({
    id,
    name: id,
    description: "Persona mới",
    instructions: "Mô tả vai trò và cách đánh giá sản phẩm...",
    evaluation: {
      rubric: ["clarity", "usability"],
      output_format: "json",
    },
    browser: { viewport: "1280x720", locale: "vi-VN" },
    fly: { app: `persona-${id}`, region: "sin" },
  });
}
