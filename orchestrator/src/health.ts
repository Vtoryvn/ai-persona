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
    const started = Date.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      const body = (await response.json()) as { ok?: boolean; persona_id?: string };
      results.push({
        personaId: persona.id,
        name: persona.name,
        url,
        ok: response.ok && body.ok === true,
        persona_id: body.persona_id,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      results.push({
        personaId: persona.id,
        name: persona.name,
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      });
    }
  }
  return results;
}
