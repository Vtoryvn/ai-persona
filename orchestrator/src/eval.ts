import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MissionResult, PersonaConfig } from "@persona-system/shared";

export interface EvalOptions {
  productUrl: string;
  personasDir: string;
  personaIds?: string[];
  focus?: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  outDir?: string;
}

export interface PersonaEvalResult {
  persona: PersonaConfig;
  ok: boolean;
  result?: MissionResult;
  error?: string;
}

function authHeaders(): Record<string, string> {
  const token = process.env.RUNNER_AUTH_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function dispatchMission(
  persona: PersonaConfig,
  options: EvalOptions,
): Promise<PersonaEvalResult> {
  const { resolveRunnerUrl } = await import("@persona-system/shared");
  const url = `${resolveRunnerUrl(persona)}/missions`;

  const body = {
    persona_id: persona.id,
    product_url: options.productUrl,
    instructions: persona.instructions,
    rubric: persona.evaluation.rubric,
    focus: options.focus,
    auth:
      options.username && options.password
        ? {
            username: options.username,
            password: options.password,
            login_url: options.loginUrl,
          }
        : undefined,
    browser: persona.browser,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.MISSION_TIMEOUT_MS ?? 600_000)),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return {
        persona,
        ok: false,
        error: String(payload.message ?? payload.error ?? response.statusText),
      };
    }

    return { persona, ok: true, result: payload as unknown as MissionResult };
  } catch (error) {
    return {
      persona,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runEval(options: EvalOptions): Promise<{
  runDir: string;
  results: PersonaEvalResult[];
}> {
  const { loadPersonasDir } = await import("@persona-system/shared");
  const all = await loadPersonasDir(options.personasDir);
  const selected = options.personaIds?.length
    ? all.filter((p) => options.personaIds!.includes(p.id))
    : all;

  if (!selected.length) {
    throw new Error("No personas matched the filter");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = options.outDir ?? path.join("artifacts", "evaluations", stamp);
  await mkdir(runDir, { recursive: true });

  const results: PersonaEvalResult[] = [];
  for (const persona of selected) {
    process.stderr.write(`→ ${persona.name} (${persona.id})...\n`);
    const result = await dispatchMission(persona, options);
    results.push(result);

    await writeFile(
      path.join(runDir, `${persona.id}.json`),
      JSON.stringify(result.ok ? result.result : { error: result.error }, null, 2),
      "utf8",
    );
  }

  return { runDir, results };
}
