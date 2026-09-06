import { access, readFile } from "node:fs/promises";
import path from "node:path";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: string;
}

export interface ResolveLlmOptions {
  repoRoot?: string;
  lumenProjectPath?: string;
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

export function resolveLumenProjectPath(options: ResolveLlmOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.LUMEN_PROJECT_PATH) {
    return path.resolve(env.LUMEN_PROJECT_PATH);
  }
  if (options.lumenProjectPath) {
    return path.resolve(options.lumenProjectPath);
  }
  const repoRoot = options.repoRoot ?? process.cwd();
  return path.resolve(repoRoot, "..", "lumen");
}

async function loadLumenEnvFiles(lumenRoot: string): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const name of [".env", ".env.local"]) {
    const filePath = path.join(lumenRoot, name);
    if (!(await fileExists(filePath))) continue;
    Object.assign(merged, parseEnvFile(await readFile(filePath, "utf8")));
  }
  return merged;
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "••••••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

export async function resolveLlmConfig(options: ResolveLlmOptions = {}): Promise<LlmConfig> {
  const env = options.env ?? process.env;

  if (env.LLM_API_KEY && env.LLM_BASE_URL) {
    return {
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL,
      model: env.LLM_MODEL ?? env.MODEL ?? "gpt-4o",
      source: "process.env (LLM_*)",
    };
  }

  const lumenRoot = resolveLumenProjectPath(options);
  const lumenEnv = await loadLumenEnvFiles(lumenRoot);
  const apiKey =
    env.LLM_API_KEY ??
    env.OPENAI_API_KEY ??
    lumenEnv.OPENAI_API_KEY ??
    lumenEnv.LLM_API_KEY ??
    "";
  const baseUrl =
    env.LLM_BASE_URL ??
    env.OPENAI_BASE_URL ??
    lumenEnv.OPENAI_BASE_URL ??
    lumenEnv.LLM_BASE_URL ??
    "";
  const model =
    env.LLM_MODEL ?? env.MODEL ?? lumenEnv.LLM_MODEL ?? lumenEnv.MODEL ?? "gpt-4o";

  if (apiKey && baseUrl) {
    return {
      apiKey,
      baseUrl,
      model,
      source: `lumen (${lumenRoot})`,
    };
  }

  throw new Error(
    `LLM config not found. Set LLM_* in .env or configure OPENAI_* in ${lumenRoot}/.env.local`,
  );
}

export function applyLlmConfigToEnv(config: LlmConfig, env: NodeJS.ProcessEnv = process.env): void {
  env.LLM_API_KEY = config.apiKey;
  env.LLM_BASE_URL = config.baseUrl;
  env.LLM_MODEL = config.model;
}
