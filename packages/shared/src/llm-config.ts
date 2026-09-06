import { access, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: string;
}

export interface ResolveLlmOptions {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
}

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
      if (pkg.name === "persona-system") return dir;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export async function loadProjectEnv(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const loaded: string[] = [];
  for (const name of [".env", ".env.local"]) {
    const filePath = path.join(repoRoot, name);
    if (!(await fileExists(filePath))) continue;
    const vars = parseEnvFile(await readFile(filePath, "utf8"));
    for (const [key, value] of Object.entries(vars)) {
      if (!env[key]) env[key] = value;
    }
    loaded.push(filePath);
  }
  return loaded;
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "••••••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

export async function resolveLlmConfig(options: ResolveLlmOptions = {}): Promise<LlmConfig> {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const loadedFrom = await loadProjectEnv(repoRoot, env);

  const apiKey = env.LLM_API_KEY ?? env.OPENAI_API_KEY ?? "";
  const baseUrl = env.LLM_BASE_URL ?? env.OPENAI_BASE_URL ?? "";
  const model = env.LLM_MODEL ?? env.MODEL ?? "gpt-4o";

  if (!apiKey || !baseUrl) {
    throw new Error(`LLM config not found. Add LLM_* to ${path.join(repoRoot, ".env")}`);
  }

  const source =
    loadedFrom.length > 0
      ? loadedFrom.map((p) => path.basename(p)).join(", ")
      : env.LLM_API_KEY || env.OPENAI_API_KEY
        ? "process.env"
        : ".env";

  return { apiKey, baseUrl, model, source };
}

export function applyLlmConfigToEnv(config: LlmConfig, env: NodeJS.ProcessEnv = process.env): void {
  env.LLM_API_KEY = config.apiKey;
  env.LLM_BASE_URL = config.baseUrl;
  env.LLM_MODEL = config.model;
}
