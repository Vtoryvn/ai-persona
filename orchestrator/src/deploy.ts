import { spawn } from "node:child_process";
import path from "node:path";
import { loadPersonasDir, resolveLlmConfig, type PersonaConfig } from "@persona-system/shared";

export type LogFn = (line: string) => void;

function run(cmd: string, args: string[], cwd: string, onLog?: LogFn): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) onLog?.(line);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) onLog?.(line);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function selectPersonas(all: PersonaConfig[], personaIds?: string[]): PersonaConfig[] {
  return personaIds?.length ? all.filter((p) => personaIds.includes(p.id)) : all;
}

export async function deployPersonas(options: {
  personasDir: string;
  personaIds?: string[];
  repoRoot: string;
  onLog?: LogFn;
}): Promise<{ deployed: string[] }> {
  const all = await loadPersonasDir(options.personasDir);
  const selected = selectPersonas(all, options.personaIds);
  const deployed: string[] = [];

  for (const persona of selected) {
    options.onLog?.(`Deploying ${persona.fly.app} (${persona.id})...`);
    const flyToml = path.join(options.repoRoot, "deploy", "persona-runner", "fly.toml");
    const example = path.join(options.repoRoot, "deploy", "persona-runner", "fly.toml.example");

    const { readFile, writeFile } = await import("node:fs/promises");
    let template = await readFile(example, "utf8");
    template = template
      .replace(/app = "[^"]+"/, `app = "${persona.fly.app}"`)
      .replace(/primary_region = "[^"]+"/, `primary_region = "${persona.fly.region}"`)
      .replace(/PERSONA_ID = "[^"]+"/, `PERSONA_ID = "${persona.id}"`);

    const viewport = persona.browser?.viewport ?? "1280x720";
    template = template.replace(/MCP_VIEWPORT = "[^"]+"/, `MCP_VIEWPORT = "${viewport}"`);

    await writeFile(flyToml, template, "utf8");

    let code = await run("fly", ["apps", "create", persona.fly.app, "--yes"], options.repoRoot, options.onLog);
    if (code !== 0) options.onLog?.(`(app ${persona.fly.app} may already exist, continuing)`);

    code = await run(
      "fly",
      ["deploy", "--config", flyToml, "--dockerfile", "deploy/persona-runner/Dockerfile"],
      options.repoRoot,
      options.onLog,
    );
    if (code !== 0) throw new Error(`Deploy failed for ${persona.id} (exit ${code})`);
    deployed.push(persona.id);
    options.onLog?.(`✓ Deployed ${persona.fly.app}`);
  }

  return { deployed };
}

export async function syncLlmSecrets(options: {
  personasDir: string;
  personaIds?: string[];
  repoRoot: string;
  onLog?: LogFn;
}): Promise<{ synced: string[] }> {
  const llm = await resolveLlmConfig({ repoRoot: options.repoRoot });
  const all = await loadPersonasDir(options.personasDir);
  const selected = selectPersonas(all, options.personaIds);
  const synced: string[] = [];

  for (const persona of selected) {
    options.onLog?.(`Sync LLM secrets → ${persona.fly.app} (${llm.source})`);
    const code = await run(
      "fly",
      [
        "secrets",
        "set",
        "-a",
        persona.fly.app,
        `LLM_API_KEY=${llm.apiKey}`,
        `LLM_BASE_URL=${llm.baseUrl}`,
        `LLM_MODEL=${llm.model}`,
      ],
      options.repoRoot,
      options.onLog,
    );
    if (code !== 0) throw new Error(`Secret sync failed for ${persona.id}`);
    synced.push(persona.id);
    options.onLog?.(`✓ Secrets synced for ${persona.fly.app}`);
  }

  return { synced };
}
