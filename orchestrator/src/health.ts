import { loadPersonasDir, resolveRunnerUrl, type PersonaConfig } from "@persona-system/shared";

export interface HealthResult {
  personaId: string;
  name: string;
  url: string;
  ok: boolean;
  persona_id?: string;
  error?: string;
  latencyMs?: number;
}

const HEALTH_TIMEOUT_MS = Number(process.env.RUNNER_HEALTH_TIMEOUT_MS ?? 180_000);
const HEALTH_POLL_MS = Number(process.env.RUNNER_HEALTH_POLL_MS ?? 3_000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHealthBody(text: string, status: number): { ok: boolean; persona_id?: string; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: `Empty response (HTTP ${status}) — VM có thể đang khởi động` };
  }

  try {
    const body = JSON.parse(trimmed) as { ok?: boolean; persona_id?: string; chrome_ready?: boolean };
    if (!body.ok) {
      return { ok: false, persona_id: body.persona_id, error: `Health not ok (HTTP ${status})` };
    }
    if (body.chrome_ready === false) {
      return {
        ok: false,
        persona_id: body.persona_id,
        error: "Runner up but Chrome chưa sẵn sàng",
      };
    }
    return { ok: true, persona_id: body.persona_id };
  } catch {
    return {
      ok: false,
      error: `Invalid JSON (HTTP ${status}): ${trimmed.slice(0, 160)}`,
    };
  }
}

async function pingHealth(url: string): Promise<{ ok: boolean; persona_id?: string; error?: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  const parsed = parseHealthBody(text, response.status);
  if (!response.ok && parsed.ok) {
    return { ok: false, persona_id: parsed.persona_id, error: `HTTP ${response.status}` };
  }
  return parsed;
}

async function waitForHealth(url: string): Promise<{ ok: boolean; persona_id?: string; error?: string; latencyMs: number }> {
  const started = Date.now();
  const deadline = started + HEALTH_TIMEOUT_MS;
  let lastError = "Runner not ready";

  while (Date.now() < deadline) {
    try {
      const result = await pingHealth(url);
      if (result.ok) {
        return { ...result, latencyMs: Date.now() - started };
      }
      lastError = result.error ?? lastError;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (Date.now() + HEALTH_POLL_MS >= deadline) break;
    await sleep(HEALTH_POLL_MS);
  }

  return { ok: false, error: lastError, latencyMs: Date.now() - started };
}

export async function checkPersonasHealth(options: {
  personasDir: string;
  personaIds?: string[];
}): Promise<HealthResult[]> {
  const all = await loadPersonasDir(options.personasDir);
  const selected = options.personaIds?.length
    ? all.filter((p) => options.personaIds!.includes(p.id))
    : all;

  const results: HealthResult[] = [];
  for (const persona of selected) {
    const url = `${resolveRunnerUrl(persona)}/health`;
    const outcome = await waitForHealth(url);
    results.push({
      personaId: persona.id,
      name: persona.name,
      url,
      ok: outcome.ok,
      persona_id: outcome.persona_id,
      error: outcome.error,
      latencyMs: outcome.latencyMs,
    });
  }
  return results;
}
