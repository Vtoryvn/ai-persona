import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MissionEvent, MissionResult, PersonaConfig } from "@persona-system/shared";

export type LogFn = (line: string) => void;
export type EventFn = (event: MissionEvent) => void;

export interface EvalOptions {
  prompt: string;
  personasDir: string;
  personaIds?: string[];
  productUrl?: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  outDir?: string;
  onLog?: LogFn;
  onEvent?: EventFn;
}

export interface PersonaEvalResult {
  persona: PersonaConfig;
  ok: boolean;
  result?: MissionResult;
  error?: string;
}

function authHeaders(): Record<string, string> {
  const token = process.env.RUNNER_AUTH_TOKEN;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readSse(
  response: Response,
  personaId: string,
  onEvent?: EventFn,
): Promise<MissionResult | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastResult: MissionResult | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const event = JSON.parse(line.slice(6)) as MissionEvent;
        event.personaId ??= personaId;
        onEvent?.(event);
        if (event.type === "result" && event.result) lastResult = event.result;
      } catch {
        // ignore malformed events
      }
    }
  }

  return lastResult;
}

async function dispatchMission(
  persona: PersonaConfig,
  options: EvalOptions,
): Promise<PersonaEvalResult> {
  const { resolveRunnerUrl } = await import("@persona-system/shared");
  const url = `${resolveRunnerUrl(persona)}/missions`;

  const body = {
    persona_id: persona.id,
    prompt: options.prompt,
    product_url: options.productUrl,
    instructions: persona.instructions,
    rubric: persona.evaluation?.rubric,
    stream: true,
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

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const result = await readSse(response, persona.id, options.onEvent);
      if (!response.ok && !result) {
        return { persona, ok: false, error: response.statusText };
      }
      if (!result) return { persona, ok: false, error: "stream ended without result" };
      return { persona, ok: true, result };
    }

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
    options.onLog?.(`→ ${persona.name} (${persona.id})...`);
    options.onEvent?.({
      type: "status",
      at: new Date().toISOString(),
      personaId: persona.id,
      message: `Bắt đầu ${persona.name}`,
    });
    const result = await dispatchMission(persona, options);
    results.push(result);
    options.onLog?.(
      result.ok ? `✓ ${persona.id} done` : `✗ ${persona.id}: ${result.error ?? "failed"}`,
    );

    await writeFile(
      path.join(runDir, `${persona.id}.json`),
      JSON.stringify(result.ok ? result.result : { error: result.error }, null, 2),
      "utf8",
    );
  }

  return { runDir, results };
}
